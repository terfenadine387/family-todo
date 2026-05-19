const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

// Firebaseの裏側の権限を初期化
admin.initializeApp();

// 「notifications」コレクションに新しいデータが作られたら発動する関数（第2世代）
exports.sendNotificationOnComplete = onDocumentCreated("notifications/{docId}", async (event) => {
  // 作成されたデータが存在しない場合は終了
  if (!event.data) return;

  const data = event.data.data();

  // 完了通知以外なら何もしない
  if (data.type !== "complete") return;

  const senderId = data.from; // 完了した人のID (例: "mom")
  const todoTitle = data.todoTitle; // タスクの名前

  // メンバーの名前の変換用リスト
  const nameMap = {
    mom: "ママ",
    dad: "パパ",
    shiko: "しこう",
  };
  const senderName = nameMap[senderId] || "誰か";

  // iPhoneなどに送るプッシュ通知の中身
  const payload = {
    notification: {
      title: "タスク完了！",
      body: `${senderName}が「${todoTitle}」を完了しました✅`,
    },
    // iPhoneで通知音が鳴るようにするおまじない
    apns: {
      payload: {
        aps: {
          sound: "default",
        },
      },
    },
  };

  // Firestoreの「members」コレクションから、通知を送る相手のトークンを探す
  const membersSnap = await admin.firestore().collection("members").get();
  const tokens = [];

  membersSnap.forEach((doc) => {
    const memberData = doc.data();
    // 自分（完了した本人）以外で、FCMトークンを持っている人にだけ送る
    if (doc.id !== senderId && memberData.fcmToken) {
      tokens.push(memberData.fcmToken);
    }
  });

  // 送る相手がいない場合は終了
  if (tokens.length === 0) {
    console.log("送信先のトークンがありませんでした。");
    return;
  }

  // プッシュ通知を一斉送信！
  try {
    const response = await admin.messaging().sendEachForMulticast({
      tokens: tokens,
      notification: payload.notification,
      apns: payload.apns,
    });
    console.log("通知の送信に成功しました:", response.successCount, "件");
  } catch (error) {
    console.error("通知の送信中にエラーが発生しました:", error);
  }
});