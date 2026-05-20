const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();

const nameMap = {
  mom: "ママ",
  dad: "パパ",
  shiko: "しこう",
};

// ── 完了通知（既存） ──────────────────────────────────────
exports.sendNotificationOnComplete = onDocumentCreated(
  "notifications/{docId}",
  async (event) => {
    if (!event.data) return;
    const data = event.data.data();
    if (data.type !== "complete") return;

    const senderId = data.from;
    const todoTitle = data.todoTitle;
    const senderName = nameMap[senderId] || "誰か";

    const payload = {
      notification: {
        title: "タスク完了！",
        body: `${senderName}が「${todoTitle}」を完了しました✅`,
      },
      apns: {
        payload: { aps: { sound: "default" } },
      },
    };

    const membersSnap = await admin.firestore().collection("members").get();
    const tokens = [];
    for (const memberDoc of membersSnap.docs) {
      if (memberDoc.id === senderId) continue;
      const tokensSnap = await memberDoc.ref.collection("tokens").get();
      tokensSnap.docs.forEach(t => {
        const token = t.data().fcmToken;
        if (token) tokens.push(token);
      });
    }

    if (tokens.length === 0) return;

    try {
      const response = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: payload.notification,
        apns: payload.apns,
      });
      console.log("完了通知送信:", response.successCount, "件");
    } catch (error) {
      console.error("完了通知エラー:", error);
    }
  }
);

// ── 時刻通知（新規）─────────────────────────────────────
exports.sendScheduledNotifications = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "Asia/Tokyo",
    region: "asia-northeast1",
  },
  async () => {
const now = new Date();

    // 日本時間に変換
    const jstOffset = 9 * 60; // 分
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);

    const hh = String(jstNow.getUTCHours()).padStart(2, "0");
    const mm = String(jstNow.getUTCMinutes()).padStart(2, "0");
    const currentTime = `${hh}:${mm}`;
    const todayStr = jstNow.toISOString().slice(0, 10);

    console.log(`実行時刻(JST): ${currentTime} / ${todayStr}`);

    console.log(`時刻通知チェック: ${currentTime} / ${todayStr}`);

    const todosSnap = await admin.firestore().collection("todos").get();
    const todos = todosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // 変更後：端末ごとのトークンをすべて取得
    const membersSnap = await admin.firestore().collection("members").get();
    const members = {}; // { dad: ["token1", "token2"], mom: ["token3"] }

    for (const memberDoc of membersSnap.docs) {
      const tokensSnap = await memberDoc.ref.collection("tokens").get();
      const tokens = tokensSnap.docs.map(t => t.data().fcmToken).filter(Boolean);
      if (tokens.length > 0) {
        members[memberDoc.id] = tokens;
      }
    }

    for (const todo of todos) {
      if (todo.notifyTime !== currentTime) continue;
      if (!todo.notifyEnabled) continue;
      if (!occursOn(todo, todayStr)) continue;
      if ((todo.completedDates || []).includes(todayStr)) continue;

      const tokens = members[todo.assignee];
      if (!tokens || tokens.length === 0) continue;

      const assigneeName = nameMap[todo.assignee] || todo.assignee;

      try {
        await admin.messaging().sendEachForMulticast({
          tokens,
          notification: {
            title: "⏰ やることリマインダー",
            body: `${assigneeName}、「${todo.title}」の時間です！`,
          },
          apns: {
            payload: { aps: { sound: "default" } },
          },
          webpush: {
            fcmOptions: {
              link: "https://family-todo-six.vercel.app",
            },
          },
        });
        console.log(`時刻通知送信: ${todo.title} → ${todo.assignee} (${tokens.length}台)`);
      } catch (err) {
        console.error(`時刻通知失敗: ${todo.title}`, err.message);
      }
    }
  }
);

// ── ヘルパー関数 ──────────────────────────────────────────
function occursOn(todo, dateStr) {
  const date = parseYMD(dateStr);
  const start = todo.startDate ? parseYMD(todo.startDate) : null;
  const end = todo.endDate ? parseYMD(todo.endDate) : null;

  if (start && date < start) return false;
  if (end && date > end) return false;
  if ((todo.skippedDates || []).includes(dateStr)) return false;

  const t = todo.repeat;
  if (t === "once") return todo.startDate === dateStr;
  if (t === "daily") return true;
  if (t === "weekly") {
    const wd = (date.getDay() + 6) % 7;
    return (todo.weekdays || []).includes(wd);
  }
  if (t === "monthly_date") return date.getDate() === (todo.monthDay || 1);
  if (t === "monthly_weekday") {
    const wd = (date.getDay() + 6) % 7;
    if (wd !== (todo.monthWeekDay ?? 0)) return false;
    const pos = todo.monthWeekPos ?? 0;
    if (pos === 4) {
      const next = new Date(date);
      next.setDate(date.getDate() + 7);
      return next.getMonth() !== date.getMonth();
    }
    return Math.ceil(date.getDate() / 7) - 1 === pos;
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
    if (unit === "day") return diff % interval === 0;
    if (unit === "week") return diff % (interval * 7) === 0;
    if (unit === "month") {
      const months =
        (date.getFullYear() - start.getFullYear()) * 12 +
        (date.getMonth() - start.getMonth());
      return months % interval === 0 && date.getDate() === start.getDate();
    }
  }
  return false;
}

function parseYMD(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}