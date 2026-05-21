import { useState, useEffect, useRef } from "react";
import { db, VAPID_KEY } from "./firebase";
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import {
  isSupported,
  getMessaging,
  getToken,
  onMessage,
} from "firebase/messaging";

// ── Constants ──────────────────────────────────────────────
const MEMBERS = [
  { id: "all",   name: "すべて", emoji: "👨‍👩‍👦", color: "#94a3b8" },
  { id: "mom",   name: "ママ",   emoji: "👩",      color: "#ff6b9d" },
  { id: "dad",   name: "パパ",   emoji: "👨",      color: "#4ecdc4" },
  { id: "shiko", name: "しこう", emoji: "👦",      color: "#ffa94d" },
];

const WEEKDAYS_JP = ["月","火","水","木","金","土","日"];
const MONTH_WEEK_POS = ["第1","第2","第3","第4","最終"];

const REPEAT_TYPES = [
  { v: "once",             l: "一度だけ" },
  { v: "daily",            l: "毎日" },
  { v: "weekly",           l: "毎週" },
  { v: "monthly_date",     l: "毎月（日付）" },
  { v: "monthly_weekday",  l: "毎月（曜日）" },
  { v: "yearly",           l: "毎年" },
  { v: "custom",           l: "カスタム" },
];

// ── Helpers ────────────────────────────────────────────────
function toYMD(date) {
  // 日本時間基準で YYYY-MM-DD を返す
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}
function parseYMD(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function weekdayIndex(date) {
  return (date.getDay() + 6) % 7;
}
function nthWeekdayOfMonth(date) {
  return Math.ceil(date.getDate() / 7) - 1; // 0-based
}
function isLastWeekdayOfMonth(date) {
  const next = new Date(date); next.setDate(date.getDate() + 7);
  return next.getMonth() !== date.getMonth();
}

function todoOccursOn(todo, dateStr) {
  const date = parseYMD(dateStr);
  const start = todo.startDate ? parseYMD(todo.startDate) : null;
  const end   = todo.endDate   ? parseYMD(todo.endDate)   : null;

  if (start && date < start) return false;
  if (end   && date > end)   return false;
  if (todo.skippedDates && todo.skippedDates.includes(dateStr)) return false;

  const t = todo.repeat;
  if (t === "once")   return todo.startDate === dateStr;
  if (t === "daily")  return true;
  if (t === "weekly") {
    const wd = weekdayIndex(date);
    return (todo.weekdays || []).includes(wd);
  }
  if (t === "monthly_date") return date.getDate() === (todo.monthDay || 1);
  if (t === "monthly_weekday") {
    const wd = weekdayIndex(date);
    if (wd !== (todo.monthWeekDay ?? 0)) return false;
    const pos = todo.monthWeekPos ?? 0;
    if (pos === 4) return isLastWeekdayOfMonth(date);
    return nthWeekdayOfMonth(date) === pos;
  }
  if (t === "yearly") {
    if (!todo.yearDate) return false;
    const yd = parseYMD(todo.yearDate);
    return date.getMonth() === yd.getMonth() && date.getDate() === yd.getDate();
  }
  if (t === "custom") {
    if (!start) return false;
    const interval = todo.customInterval || 1;
    const unit = todo.customUnit || "day";
    const diff = Math.round((date - start) / 86400000);
    if (diff < 0) return false;
    if (unit === "day")   return diff % interval === 0;
    if (unit === "week")  return diff % (interval * 7) === 0;
    if (unit === "month") {
      const months = (date.getFullYear() - start.getFullYear()) * 12
        + (date.getMonth() - start.getMonth());
      return months % interval === 0 && date.getDate() === start.getDate();
    }
  }
  return false;
}

function getRepeatLabel(todo) {
  const t = todo.repeat;
  if (t === "once")   return todo.startDate ? `${todo.startDate.slice(5).replace("-","/")}のみ` : "一度だけ";
  if (t === "daily")  return "毎日";
  if (t === "weekly") {
    const days = (todo.weekdays || []).map(i => WEEKDAYS_JP[i]).join("・");
    return days ? `毎週 ${days}` : "毎週";
  }
  if (t === "monthly_date")    return todo.monthDay ? `毎月${todo.monthDay}日` : "毎月";
  if (t === "monthly_weekday") {
    const pos = MONTH_WEEK_POS[todo.monthWeekPos ?? 0];
    const day = WEEKDAYS_JP[todo.monthWeekDay ?? 0];
    return `毎月 ${pos}${day}曜`;
  }
  if (t === "yearly")  return todo.yearDate ? `毎年 ${todo.yearDate.slice(5).replace("-","/")}` : "毎年";
  if (t === "custom") {
    const u = todo.customUnit === "week" ? "週" : todo.customUnit === "month" ? "ヶ月" : "日";
    return `${todo.customInterval || 1}${u}ごと`;
  }
  return "";
}

function isRecurring(todo) {
  return todo.repeat !== "once";
}

const TODAY = toYMD(new Date());

const iStyle = {
  width:"100%", padding:"9px 12px",
  background:"#0f172a", border:"1px solid #334155",
  borderRadius:10, color:"#e2e8f0", fontSize:14, colorScheme:"dark",
};

function MemberSelect({ onSelect }) {
  // ★ボタンを押した瞬間に通知許可を出す（デフォルト時のみ）
  const handleSelect = async (id) => {
    if (typeof Notification !== "undefined" && Notification.requestPermission) {
      if (Notification.permission === "default") {
        try { await Notification.requestPermission(); } catch (e) {}
      }
    }
    onSelect(id);
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#0f172a",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "40px 20px",
      fontFamily: "'Noto Sans JP','Hiragino Sans',sans-serif",
    }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: "#f1f5f9", marginBottom: 8 }}>
        👨‍👩‍👦 家族のやること
      </div>
      <div style={{ fontSize: 14, color: "#64748b", marginBottom: 48 }}>
        だれですか？
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%", maxWidth: 280 }}>
        {MEMBERS.filter(m => m.id !== "all").map(m => (
          <button key={m.id} onClick={() => handleSelect(m.id)} style={{
            padding: "20px 24px", borderRadius: 20, border: `2px solid ${m.color}44`,
            background: m.color + "11", color: "#f1f5f9", fontSize: 18, fontWeight: 700,
            cursor: "pointer", display: "flex", alignItems: "center", gap: 16, transition: "all 0.18s",
          }}>
            <span style={{ fontSize: 36 }}>{m.emoji}</span>
            <span>{m.name}</span>
            <span style={{ marginLeft: "auto", fontSize: 12, color: m.color, background: m.color + "22", padding: "4px 12px", borderRadius: 20 }}>タップ</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Toast({ msg, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, []);
  return (
    <div style={{
      position:"fixed", top:20, left:"50%", transform:"translateX(-50%)",
      background:"#1e293b", color:"#fff", padding:"12px 20px", borderRadius:14, fontSize:14, zIndex:9999,
      boxShadow:"0 8px 32px #0008", border:"1px solid #334155", display:"flex", alignItems:"center", gap:8,
      animation:"slideDown 0.3s ease", whiteSpace:"nowrap"
    }}>🔔 {msg}</div>
  );
}

function ScopeDialog({ title, onThisDay, onFromHere, onCancel }) {
  return (
    <div style={{ position:"fixed", inset:0, zIndex:500, background:"#000b", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:"#1e293b", borderRadius:20, padding:"24px 20px", width:300, border:"1px solid #334155", textAlign:"center" }}>
        <div style={{ fontWeight:700, fontSize:15, marginBottom:8, color:"#e2e8f0" }}>{title}</div>
        <div style={{ fontSize:13, color:"#64748b", marginBottom:20 }}>繰り返しタスクです。どの範囲に適用しますか？</div>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <button onClick={onThisDay} style={{ padding:"11px 0", borderRadius:12, border:"none", background:"#0f172a", color:"#e2e8f0", fontSize:14, fontWeight:600, cursor:"pointer" }}>この日だけ</button>
          <button onClick={onFromHere} style={{ padding:"11px 0", borderRadius:12, border:"none", background:"#0f172a", color:"#e2e8f0", fontSize:14, fontWeight:600, cursor:"pointer" }}>この日以降すべて</button>
          <button onClick={onCancel} style={{ padding:"11px 0", borderRadius:12, border:"none", background:"transparent", color:"#64748b", fontSize:13, cursor:"pointer" }}>キャンセル</button>
        </div>
      </div>
    </div>
  );
}

function RepeatEditor({ draft, setDraft, color }) {
  const set = p => setDraft(d => ({ ...d, ...p }));
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
        {REPEAT_TYPES.map(r => (
          <button key={r.v} onClick={() => set({ repeat:r.v })} style={{
            padding:"9px 0", borderRadius:10, border:`1px solid ${draft.repeat === r.v ? color : "#334155"}`,
            background: draft.repeat === r.v ? color : "#0f172a", color: draft.repeat === r.v ? "#fff" : "#64748b",
            fontWeight: draft.repeat === r.v ? 700 : 400, fontSize:13, cursor:"pointer"
          }}>{r.l}</button>
        ))}
      </div>

      {draft.repeat === "weekly" && (
        <div>
          <div style={{ fontSize:11, color:"#64748b", marginBottom:6 }}>曜日（複数可）</div>
          <div style={{ display:"flex", gap:5 }}>
            {WEEKDAYS_JP.map((d,i) => {
              const sel = (draft.weekdays||[]).includes(i);
              const ac = i===5?"#60a5fa":i===6?"#f87171":color;
              return (
                <button key={i} onClick={() => {
                  const cur = draft.weekdays||[];
                  set({ weekdays: sel ? cur.filter(x=>x!==i) : [...cur,i].sort() });
                }} style={{
                  flex:1, padding:"8px 0", borderRadius:10, border:`1px solid ${sel?ac:"#334155"}`,
                  background: sel?ac:"#0f172a", color: sel?"#fff":i===5?"#60a5fa":i===6?"#f87171":"#94a3b8",
                  fontSize:13, fontWeight:sel?700:400, cursor:"pointer"
                }}>{d}</button>
              );
            })}
          </div>
        </div>
      )}

      {draft.repeat === "monthly_date" && (
        <div>
          <div style={{ fontSize:11, color:"#64748b", marginBottom:6 }}>毎月 何日？</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
            {Array.from({length:31},(_,i)=>i+1).map(d => (
              <button key={d} onClick={()=>set({monthDay:d})} style={{
                padding:"7px 0", borderRadius:8, border:`1px solid ${draft.monthDay===d?color:"#334155"}`,
                background: draft.monthDay===d?color:"#0f172a", color: draft.monthDay===d?"#fff":"#64748b",
                fontSize:12, fontWeight:draft.monthDay===d?700:400, cursor:"pointer"
              }}>{d}</button>
            ))}
          </div>
        </div>
      )}

      {draft.repeat === "monthly_weekday" && (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <div>
            <div style={{ fontSize:11, color:"#64748b", marginBottom:5 }}>週</div>
            <div style={{ display:"flex", gap:5 }}>
              {MONTH_WEEK_POS.map((p,i) => (
                <button key={i} onClick={()=>set({monthWeekPos:i})} style={{
                  flex:1, padding:"8px 0", borderRadius:10, border:`1px solid ${draft.monthWeekPos===i?color:"#334155"}`,
                  background: draft.monthWeekPos===i?color:"#0f172a", color: draft.monthWeekPos===i?"#fff":"#64748b",
                  fontSize:12, fontWeight:draft.monthWeekPos===i?700:400, cursor:"pointer"
                }}>{p}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize:11, color:"#64748b", marginBottom:5 }}>曜日</div>
            <div style={{ display:"flex", gap:5 }}>
              {WEEKDAYS_JP.map((d,i) => (
                <button key={i} onClick={()=>set({monthWeekDay:i})} style={{
                  flex:1, padding:"8px 0", borderRadius:10, border:`1px solid ${draft.monthWeekDay===i?color:"#334155"}`,
                  background: draft.monthWeekDay===i?color:"#0f172a", color: draft.monthWeekDay===i?"#fff":i===5?"#60a5fa":i===6?"#f87171":"#94a3b8",
                  fontSize:12, fontWeight:draft.monthWeekDay===i?700:400, cursor:"pointer"
                }}>{d}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {draft.repeat === "yearly" && (
        <div>
          <div style={{ fontSize:11, color:"#64748b", marginBottom:5 }}>毎年の日付</div>
          <input type="date" value={draft.yearDate||""} onChange={e=>set({yearDate:e.target.value})} style={iStyle}/>
        </div>
      )}

      {draft.repeat === "custom" && (
        <div>
          <div style={{ fontSize:11, color:"#64748b", marginBottom:6 }}>繰り返し間隔</div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <input type="number" min={1} max={99} value={draft.customInterval||1}
              onChange={e=>set({customInterval:parseInt(e.target.value)||1})}
              style={{...iStyle, width:70, textAlign:"center"}}/>
            <div style={{ display:"flex", gap:6, flex:1 }}>
              {[{v:"day",l:"日ごと"},{v:"week",l:"週ごと"},{v:"month",l:"月ごと"}].map(u=>(
                <button key={u.v} onClick={()=>set({customUnit:u.v})} style={{
                  flex:1, padding:"8px 0", borderRadius:10, border:`1px solid ${draft.customUnit===u.v?color:"#334155"}`,
                  background: draft.customUnit===u.v?color:"#0f172a", color: draft.customUnit===u.v?"#fff":"#64748b",
                  fontSize:12, fontWeight:draft.customUnit===u.v?700:400, cursor:"pointer"
                }}>{u.l}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ display:"flex", gap:10 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:11, color:"#64748b", marginBottom:4 }}>
            {draft.repeat==="once"?"実施日":"開始日"}
          </div>
          <input type="date" value={draft.startDate||""} onChange={e=>set({startDate:e.target.value})} style={iStyle}/>
        </div>
        {draft.repeat!=="once" && (
          <div style={{ flex:1 }}>
            <div style={{ fontSize:11, color:"#64748b", marginBottom:4 }}>終了日（任意）</div>
            <input type="date" value={draft.endDate||""} onChange={e=>set({endDate:e.target.value})} style={iStyle}/>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Horizontal Calendar ────────────────────────────────────
function HorizontalCalendar({ selectedDate, onSelect, todos }) {
  const scrollRef = useRef(null);
  const today = new Date();

  // Build 60-day window: 30 past … today … 29 future
  const days = Array.from({length:90}, (_,i) => {
    const d = new Date(today); d.setDate(today.getDate() - 30 + i);
    return d;
  });

  // Scroll selected date into center on mount / change
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = days.findIndex(d => toYMD(d) === selectedDate);
    if (idx < 0) return;
    const itemW = 58;
    const offset = idx * itemW - el.clientWidth / 2 + itemW / 2;
    el.scrollTo({ left: Math.max(0, offset), behavior:"smooth" });
  }, [selectedDate]);

  return (
    <div ref={scrollRef} style={{ display:"flex", overflowX:"auto", gap:6, padding:"4px 20px 8px", scrollbarWidth:"none" }}>
      <style>{`.hcal::-webkit-scrollbar{display:none}`}</style>
      {days.map(d => {
        const ymd = toYMD(d);
        const isToday = ymd === toYMD(today);
        const isSel   = ymd === selectedDate;
        const wd = weekdayIndex(d);
        const isSat = wd === 5, isSun = wd === 6;
        const hasTodo = todos.some(t => todoOccursOn(t, ymd));

        return (
          <div key={ymd} onClick={() => onSelect(ymd)} style={{ flexShrink:0, width:52, display:"flex", flexDirection:"column", alignItems:"center", gap:4, cursor:"pointer" }}>
            <div style={{ fontSize:11, color: isSel ? "#fff" : isSat ? "#60a5fa" : isSun ? "#f87171" : "#64748b", fontWeight: isToday ? 700 : 400 }}>{WEEKDAYS_JP[wd]}</div>
            <div style={{
              width:46, height:52, borderRadius:14, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4,
              background: isSel ? "#ffa94d" : "transparent", border: isToday && !isSel ? "2px solid #ffa94d" : isSel ? "none" : "2px solid transparent", transition:"all 0.18s"
            }}>
              <span style={{ fontSize:20, fontWeight:700, color: isSel ? "#fff" : isSat ? "#60a5fa" : isSun ? "#f87171" : "#e2e8f0" }}>{d.getDate()}</span>
              <div style={{ width:5, height:5, borderRadius:"50%", background: hasTodo ? (isSel ? "#fff" : "#ffa94d") : "transparent" }}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────
function emptyDraft(selectedDate) {
  return {
    title:"", memo:"", assignee:"shiko", repeat:"daily", weekdays:[], monthDay:1, monthWeekPos:0, monthWeekDay:0,
    yearDate:"", customInterval:1, customUnit:"day",
    notifyEnabled: false, // ← 追加（デフォルト通知なし）
    notifyTime:"08:00", startDate: selectedDate, endDate:"", completedDates:[], skippedDates:[],
  };
}

export default function FamilyTodo() {
  const [todos, setTodos]           = useState([]);
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [memberFilter, setMemberFilter] = useState("all");
  const [showModal, setShowModal]   = useState(false);
  const [editingId, setEditingId]   = useState(null);
  const [draft, setDraft]           = useState(emptyDraft(TODAY));
  const [toast, setToast]           = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(() => localStorage.getItem("familyTodoUser") || null);
  const [debugLog, setDebugLog] = useState("");

  // Firestoreリアルタイム同期
  useEffect(() => {
    const unsubTodos = onSnapshot(collection(db, "todos"), (snap) => {
      const data = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      setTodos(data);
      setLoading(false);
    });

    const unsubNotifs = onSnapshot(collection(db, "notifications"), (snap) => {
      const data = snap.docs
        .map((d) => ({ ...d.data(), id: d.id }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setNotifications(data);
    });

    return () => {
      unsubTodos();
      unsubNotifs();
    };
  }, []);

  // 通知許可＆トークン取得
  useEffect(() => {
    if (!currentUser) return;

    setDebugLog("useEffect発火: " + currentUser);

    async function registerToken() {
      const logs = ["開始"];
      try {
        const supported = await isSupported();
        logs.push(`FCM対応: ${supported}`);
        if (!supported) {
          setDebugLog(logs.join("\n"));
          return;
        }

        const perm = Notification.permission;
        logs.push(`通知許可状態: ${perm}`);
        
        // ★自動で requestPermission() は呼ばず、許可されているかだけチェック
        if (perm !== "granted") {
          logs.push("❌ 許可されていないため処理を中断");
          setDebugLog(logs.join("\n"));
          return;
        }

        const m = getMessaging();
        logs.push("messaging取得OK");

        const token = await getToken(m, { vapidKey: VAPID_KEY });
        logs.push(`トークン: ${token ? token.slice(0, 20) + "..." : "なし"}`);

        if (token) {
          // まず既存トークンを全削除してから保存
          const tokensRef = collection(db, "members", currentUser, "tokens");
          const existing = await getDocs(tokensRef);
          await Promise.all(existing.docs.map(d => deleteDoc(d.ref)));
          
          // 新しく保存
          await addDoc(tokensRef, {
            fcmToken: token,
            updatedAt: serverTimestamp(),
            userAgent: navigator.userAgent,
          });
          console.log("トークン保存完了");
        }

      } catch (err) {
        logs.push(`エラー: ${err.message}`);
      }
      setDebugLog(logs.join("\n"));
    }

    registerToken();
  }, [currentUser]);

  // メッセージ受信
  useEffect(() => {
    if (!currentUser) return;

    let unsubMessage = null;

    isSupported().then((supported) => {
      if (!supported) return;
      try {
        const m = getMessaging();
        unsubMessage = onMessage(m, (payload) => {
          const { title, body } = payload.notification;
          showToast(`${title}：${body}`);
        });
      } catch (e) {
        console.warn("onMessage失敗:", e);
      }
    });

    return () => {
      if (unsubMessage) unsubMessage();
    };
  }, [currentUser]);

  const [scopeDialog, setScopeDialog] = useState(null);

  const unread = notifications.filter(n => !n.read && n.from !== currentUser).length;

  const selDateObj = parseYMD(selectedDate);
  const M = selDateObj.getMonth() + 1;
  const D = selDateObj.getDate();

  const dayTodos = todos.filter(t => todoOccursOn(t, selectedDate));
  const visibleTodos = memberFilter === "all" ? dayTodos : dayTodos.filter(t => t.assignee === memberFilter);

  function showToast(msg) { setToast(msg); }

  function isCompleted(todo) {
    return (todo.completedDates || []).includes(selectedDate);
  }

  async function toggleComplete(todo) {
    const dates = todo.completedDates || [];
    const already = dates.includes(selectedDate);
    const next = already
      ? dates.filter((d) => d !== selectedDate)
      : [...dates, selectedDate];

    await updateDoc(doc(db, "todos", todo.id), {
      completedDates: next,
    });

    if (!already) {
      await addDoc(collection(db, "notifications"), {
        type: "complete",
        from: currentUser,
        todoTitle: todo.title,
        time: "たった今",
        read: false,
        createdAt: serverTimestamp(),
      });
      showToast(`「${todo.title}」完了！✅`);
    }
  }

  function openAdd() {
    setEditingId(null);
    setDraft(emptyDraft(selectedDate));
    setShowModal(true);
  }

  function openEdit(todo) {
    if (isRecurring(todo)) {
      setScopeDialog({
        action:"edit", todo,
        onThisDay: () => {
          setScopeDialog(null);
          setEditingId({ id: todo.id, scope:"thisDay", date: selectedDate });
          setDraft({ ...emptyDraft(selectedDate), ...todo, startDate: selectedDate, endDate: selectedDate, repeat:"once" });
          setShowModal(true);
        },
        onFromHere: () => {
          setScopeDialog(null);
          setEditingId({ id: todo.id, scope:"fromHere", date: selectedDate });
          setDraft({ ...emptyDraft(selectedDate), ...todo, startDate: selectedDate });
          setShowModal(true);
        },
      });
    } else {
      setEditingId({ id: todo.id, scope:"all" });
      setDraft({ ...emptyDraft(selectedDate), ...todo });
      setShowModal(true);
    }
  }

  async function handleDelete(todo) {
    if (isRecurring(todo)) {
      setScopeDialog({
        action: "delete", todo,
        onThisDay: async () => {
          await updateDoc(doc(db, "todos", todo.id), {
            skippedDates: [...(todo.skippedDates || []), selectedDate],
          });
          setScopeDialog(null);
          showToast(`「${todo.title}」この日をスキップしました`);
        },
        onFromHere: async () => {
          const prev = new Date(parseYMD(selectedDate));
          prev.setDate(prev.getDate() - 1);
          await updateDoc(doc(db, "todos", todo.id), {
            endDate: toYMD(prev),
          });
          setScopeDialog(null);
          showToast(`「${todo.title}」${selectedDate}以降を削除しました`);
        },
      });
    } else {
      await deleteDoc(doc(db, "todos", todo.id));
      showToast(`「${todo.title}」を削除しました`);
    }
  }

  async function save() {
    if (!draft.title.trim()) return;

    if (editingId) {
      const { id, scope, date } = editingId;

      if (scope === "thisDay") {
        const orig = todos.find((t) => t.id === id);
        await updateDoc(doc(db, "todos", id), {
          skippedDates: [...(orig.skippedDates || []), date],
        });
        await addDoc(collection(db, "todos"), {
          ...draft, startDate: date, endDate: date, repeat: "once",
          completedDates: [], skippedDates: [], createdAt: serverTimestamp(),
        });
      } else if (scope === "fromHere") {
        const prev = new Date(parseYMD(date));
        prev.setDate(prev.getDate() - 1);
        await updateDoc(doc(db, "todos", id), {
          endDate: toYMD(prev),
        });
        await addDoc(collection(db, "todos"), {
          ...draft, completedDates: [], skippedDates: [], createdAt: serverTimestamp(),
        });
      } else {
        const orig = todos.find((t) => t.id === id);
        await updateDoc(doc(db, "todos", id), {
          ...draft, completedDates: orig.completedDates || [], skippedDates: orig.skippedDates || [],
        });
      }
      showToast(`「${draft.title}」を更新しました ✏️`);
    } else {
      await addDoc(collection(db, "todos"), {
        ...draft, completedDates: [], skippedDates: [], createdAt: serverTimestamp(),
      });
      showToast(`「${draft.title}」を追加しました`);
    }

    setShowModal(false);
  }

  // ★ onerrorでの画面上書きは削除しました

  if (!currentUser) {
    return (
      <MemberSelect onSelect={(id) => {
        localStorage.setItem("familyTodoUser", id);
        setCurrentUser(id);
      }} />
    );
  }

  const accentColor = "#ffa94d";

  return (
    <div style={{
      minHeight:"100vh", background:"#0f172a",
      fontFamily:"'Noto Sans JP','Hiragino Sans',sans-serif",
      color:"#e2e8f0", maxWidth:430, margin:"0 auto",
      display:"flex", flexDirection:"column"
    }}>
      <style>{`
        @keyframes slideDown{from{transform:translateX(-50%) translateY(-16px);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}
        @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
        @keyframes slideRight{from{transform:translateX(100%)}to{transform:translateX(0)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        *{box-sizing:border-box;margin:0;padding:0}
        input,button{font-family:inherit;outline:none}
        input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.5)}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:#334155;border-radius:2px}
      `}</style>

      {toast && <Toast msg={toast} onClose={() => setToast(null)} />}
      {scopeDialog && (
        <ScopeDialog
          title={scopeDialog.action === "edit" ? "編集の範囲" : "削除の範囲"}
          onThisDay={scopeDialog.onThisDay}
          onFromHere={scopeDialog.onFromHere}
          onCancel={() => setScopeDialog(null)}
        />
      )}

      {/* ── Header ── */}
      <div style={{ padding:"20px 20px 0", display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
        <div>
          <div style={{ fontSize:32, fontWeight:800, letterSpacing:-1, color:"#f1f5f9" }}>
            {M}月{D}日
          </div>
          <div style={{ fontSize:12, color:"#64748b", marginTop:2 }}>
            {WEEKDAYS_JP[weekdayIndex(selDateObj)]}曜日
          </div>
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <button onClick={() => setSelectedDate(TODAY)} style={{
            padding:"6px 16px", borderRadius:20,
            background: selectedDate === TODAY ? accentColor : "#1e293b",
            border:`1px solid ${selectedDate===TODAY ? accentColor : "#334155"}`,
            color: selectedDate === TODAY ? "#fff" : "#94a3b8",
            fontSize:13, fontWeight:600, cursor:"pointer"
          }}>今日</button>
          {(() => {
            const u = MEMBERS.find(m => m.id === currentUser);
            return (
              <button onClick={() => {
                localStorage.removeItem("familyTodoUser");
                setCurrentUser(null);
              }} style={{
                display: "flex", alignItems: "center", gap: 6,
                background: u.color + "22", border: `1px solid ${u.color}44`,
                borderRadius: 20, padding: "6px 12px", cursor: "pointer",
                color: u.color, fontSize: 13, fontWeight: 600,
              }}>
                <span>{u.emoji}</span>
                <span>{u.name}</span>
              </button>
            );
          })()}
          <div style={{ position:"relative", cursor:"pointer" }} onClick={() => setShowNotifPanel(true)}>
            <div style={{ width:36, height:36, borderRadius:"50%", background:"#1e293b", display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, border:"1px solid #334155" }}>🔔</div>
            {unread > 0 && <div style={{ position:"absolute", top:-4, right:-4, background:"#ff4757", color:"#fff", borderRadius:"50%", width:16, height:16, fontSize:10, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700 }}>{unread}</div>}
          </div>
        </div>
      </div>

      {/* ── Horizontal Calendar ── */}
      <div style={{ marginTop:16 }}>
        <HorizontalCalendar selectedDate={selectedDate} onSelect={setSelectedDate} todos={todos} />
      </div>

      {/* ── Member filter pills ── */}
      <div style={{ display:"flex", gap:8, padding:"8px 20px 12px", overflowX:"auto", scrollbarWidth:"none" }}>
        {MEMBERS.map(m => {
          const active = memberFilter === m.id;
          return (
            <button key={m.id} onClick={() => setMemberFilter(m.id)} style={{
              flexShrink:0, padding:"6px 16px", borderRadius:20, border:"none", cursor:"pointer",
              background: active ? accentColor : "#1e293b",
              color: active ? "#fff" : "#64748b",
              fontWeight: active ? 700 : 400, fontSize:13,
              border:`1px solid ${active ? accentColor : "#334155"}`,
              transition:"all 0.18s"
            }}>{m.name}</button>
          );
        })}
      </div>

      {/* ── TODO list ── */}
      <div style={{ flex:1, padding:"0 20px", overflowY:"auto" }}>
        {visibleTodos.length === 0 && (
          <div style={{ textAlign:"center", color:"#475569", padding:"52px 0", fontSize:14 }}>
            この日のタスクはありません 🎉
          </div>
        )}
        {visibleTodos.map((todo, i) => {
          const am = MEMBERS.find(m => m.id === todo.assignee) || MEMBERS[1];
          const done = isCompleted(todo);
          return (
            <div key={`${todo.id}-${selectedDate}`} style={{
              background:"#1e293b", borderRadius:18, marginBottom:10,
              border:`1px solid ${done ? "#1e293b" : "#334155"}`,
              display:"flex", alignItems:"center", gap:12,
              padding:"14px 14px",
              animation:`fadeIn 0.25s ease ${i*0.05}s both`,
              opacity: done ? 0.5 : 1,
              transition:"opacity 0.2s"
            }}>
              {/* Icon / checkbox area */}
              <div onClick={() => toggleComplete(todo)} style={{
                width:44, height:44, borderRadius:12, flexShrink:0, cursor:"pointer",
                background: done ? am.color : am.color + "22",
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:20, transition:"all 0.2s",
                border:`2px solid ${done ? am.color : am.color + "55"}`
              }}>
                {done ? "✓" : am.emoji}
              </div>

              {/* Text */}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{
                  fontWeight:600, fontSize:15,
                  textDecoration: done ? "line-through" : "none",
                  color: done ? "#475569" : "#f1f5f9",
                  whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis"
                }}>{todo.title}</div>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:4, flexWrap:"wrap" }}>
                  <span style={{ fontSize:11, background:am.color+"22", color:am.color, padding:"2px 8px", borderRadius:10 }}>
                    {getRepeatLabel(todo)}
                  </span>
                  {todo.notifyEnabled && todo.notifyTime && <span style={{ fontSize:11, color:"#64748b" }}>⏰ {todo.notifyTime}</span>}
                  {memberFilter === "all" && <span style={{ fontSize:11, color:"#64748b" }}>{am.emoji} {am.name}</span>}
                </div>
                {todo.memo ? <div style={{ fontSize:12, color:"#64748b", marginTop:3 }}>{todo.memo}</div> : null}
              </div>

              {/* Actions */}
              <div style={{ display:"flex", flexDirection:"column", gap:6, flexShrink:0 }}>
                <button onClick={() => openEdit(todo)} style={{
                  width:32, height:32, borderRadius:10, border:"none",
                  background:"#0f172a", color:"#94a3b8", cursor:"pointer", fontSize:14
                }}>✏️</button>
                <button onClick={() => handleDelete(todo)} style={{
                  width:32, height:32, borderRadius:10, border:"none",
                  background:"#0f172a", color:"#94a3b8", cursor:"pointer", fontSize:14
                }}>🗑</button>
              </div>
            </div>
          );
        })}
        <div style={{ height:90 }} />
      </div>

      {/* ── FAB ── */}
      <button onClick={openAdd} style={{
        position:"fixed",
        bottom:24,
        right:"max(calc(50% - 215px + 20px), 20px)",
        width:56, height:56, borderRadius:"50%",
        background:`linear-gradient(135deg, ${accentColor}, #ff8c00)`,
        border:"none", color:"#fff", fontSize:28,
        cursor:"pointer", boxShadow:`0 4px 24px ${accentColor}88`,
        display:"flex", alignItems:"center", justifyContent:"center"
      }}>+</button>

      {/* ── Notification panel ── */}
      {showNotifPanel && (
        <div style={{ position:"fixed", inset:0, zIndex:200, background:"#0008" }}
          onClick={() => setShowNotifPanel(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            position:"absolute", top:0, right:0, bottom:0,
            width:"85%", maxWidth:360, background:"#0f172a",
            borderLeft:"1px solid #1e293b", display:"flex", flexDirection:"column",
            animation:"slideRight 0.25s ease"
          }}>
            <div style={{ padding:"20px 20px 14px", borderBottom:"1px solid #1e293b", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontWeight:700, fontSize:16 }}>🔔 通知</span>
              <button onClick={async () => {
                const unreadNotifs = notifications.filter(n => !n.read);
                await Promise.all(
                  unreadNotifs.map(n => updateDoc(doc(db, "notifications", n.id), { read: true }))
                );
              }} style={{ background:"none", border:"none", color:"#64748b", fontSize:12, cursor:"pointer" }}>
                すべて既読
              </button>
            </div>
            <div style={{ flex:1, overflowY:"auto" }}>
              {notifications.length === 0 && <div style={{ textAlign:"center", color:"#475569", padding:"40px 0", fontSize:13 }}>通知はありません</div>}
              {notifications
                .filter(n => n.from !== currentUser)
                .map(n => {
                  const from = MEMBERS.find(m => m.id === n.from);
                  return (
                    <div key={n.id} style={{ padding:"12px 20px", background:n.read?"transparent":"#1e293b", borderBottom:"1px solid #1e293b22", display:"flex", gap:10, alignItems:"flex-start" }}>
                      <span style={{ fontSize:22 }}>{from?.emoji}</span>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, marginBottom:2 }}>
                          <span style={{ color:from?.color, fontWeight:600 }}>{from?.name}</span>
                          <span style={{ color:"#94a3b8" }}>が「<span style={{ color:"#e2e8f0" }}>{n.todoTitle}</span>」を完了！</span>
                        </div>
                        <div style={{ fontSize:11, color:"#475569" }}>{n.time}</div>
                      </div>
                      {!n.read && <div style={{ width:8, height:8, borderRadius:"50%", background:"#ff4757", marginTop:4 }}/>}
                    </div>
                  );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Add / Edit Modal ── */}
      {showModal && (
        <div style={{ position:"fixed", inset:0, zIndex:300, background:"#000a", display:"flex", alignItems:"flex-end" }}
          onClick={() => setShowModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            width:"100%", maxWidth:430, margin:"0 auto",
            background:"#0f172a", borderRadius:"20px 20px 0 0",
            border:"1px solid #1e293b", borderBottom:"none",
            animation:"slideUp 0.28s ease",
            display:"flex", flexDirection:"column", maxHeight:"92vh"
          }}>
            <div style={{ padding:"16px 20px 14px", borderBottom:"1px solid #1e293b", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <button onClick={() => setShowModal(false)} style={{ background:"none", border:"none", color:"#64748b", fontSize:20, cursor:"pointer" }}>✕</button>
                <span style={{ fontWeight:700, fontSize:16 }}>{editingId ? "やること編集" : "やること作成"}</span>
              </div>
              <button onClick={save} style={{ background:accentColor, border:"none", color:"#fff", padding:"8px 22px", borderRadius:20, fontWeight:700, fontSize:14, cursor:"pointer" }}>登録</button>
            </div>

            <div style={{ overflowY:"auto", padding:"16px 20px 40px", display:"flex", flexDirection:"column", gap:16 }}>

              {/* Title */}
              <div>
                <div style={{ fontSize:12, color:"#64748b", marginBottom:4 }}>タイトル</div>
                <input value={draft.title} onChange={e => setDraft(d=>({...d,title:e.target.value}))}
                  placeholder="何をしますか？" style={{...iStyle, background:"#1e293b", fontSize:15}}/>
              </div>

              {/* Memo */}
              <div>
                <div style={{ fontSize:12, color:"#64748b", marginBottom:4 }}>メモ（任意）</div>
                <input value={draft.memo} onChange={e => setDraft(d=>({...d,memo:e.target.value}))}
                  placeholder="詳細を入力してください" style={{...iStyle, background:"#1e293b"}}/>
              </div>

              {/* Assignee */}
              <div>
                <div style={{ fontSize:12, color:"#64748b", marginBottom:6 }}>担当するひと</div>
                <div style={{ display:"flex", gap:8 }}>
                  {MEMBERS.filter(m=>m.id!=="all").map(m => (
                    <div key={m.id} onClick={() => setDraft(d=>({...d,assignee:m.id}))} style={{
                      flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:5,
                      padding:"9px 0", borderRadius:12, cursor:"pointer",
                      background: draft.assignee===m.id ? m.color+"33" : "#1e293b",
                      border:`1px solid ${draft.assignee===m.id ? m.color : "#334155"}`
                    }}>
                      <span style={{ fontSize:16 }}>{m.emoji}</span>
                      <span style={{ fontSize:13, color:draft.assignee===m.id?m.color:"#64748b", fontWeight:draft.assignee===m.id?700:400 }}>{m.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notify */}
              <div>
                <div style={{ fontSize:12, color:"#64748b", marginBottom:6 }}>⏰ 通知</div>
                <div style={{ background:"#1e293b", borderRadius:12, padding:"12px 14px", border:"1px solid #334155" }}>
                  {/* トグル */}
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: draft.notifyEnabled ? 12 : 0 }}>
                    <span style={{ fontSize:14, color:"#e2e8f0" }}>通知を受け取る</span>
                    <div onClick={() => setDraft(d => ({ ...d, notifyEnabled: !d.notifyEnabled }))} style={{
                      width:44, height:26, borderRadius:13, cursor:"pointer",
                      background: draft.notifyEnabled ? "#ffa94d" : "#334155",
                      position:"relative", transition:"background 0.2s"
                    }}>
                      <div style={{
                        position:"absolute", top:3,
                        left: draft.notifyEnabled ? 21 : 3,
                        width:20, height:20, borderRadius:"50%",
                        background:"#fff", transition:"left 0.2s"
                      }}/>
                    </div>
                  </div>
                  {/* 時刻選択（通知ONのときだけ表示） */}
                  {draft.notifyEnabled && (
                    <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                      <input type="time" value={draft.notifyTime||"08:00"}
                        onChange={e => setDraft(d=>({...d,notifyTime:e.target.value}))}
                        style={{...iStyle, background:"#0f172a", flex:1}}/>
                      <span style={{ fontSize:12, color:"#64748b", whiteSpace:"nowrap" }}>に通知</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Schedule */}
              <div>
                <div style={{ fontSize:12, color:"#64748b", marginBottom:8 }}>📅 スケジュール</div>
                <div style={{ background:"#1e293b", borderRadius:14, padding:14, border:"1px solid #334155" }}>
                  <RepeatEditor draft={draft} setDraft={setDraft} color={accentColor}/>
                </div>
              </div>

              {/* Preview */}
              <div style={{ background:accentColor+"11", borderRadius:12, padding:"10px 14px", border:`1px solid ${accentColor}33` }}>
                <div style={{ fontSize:11, color:"#64748b", marginBottom:4 }}>設定プレビュー</div>
                <div style={{ fontSize:14, color:accentColor, fontWeight:600 }}>
                  {getRepeatLabel(draft)}
                  {draft.notifyEnabled && draft.notifyTime ? ` ・ ⏰${draft.notifyTime}` : ""}
                  {draft.endDate ? ` ・ 〜${draft.endDate}まで` : ""}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}