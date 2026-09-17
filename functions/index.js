/**
 * BUYERO REFERRAL TRACKING & ELIGIBILITY ENGINE
 * Cloud Functions (Firebase Admin & Node.js Environment)
 *
 * Enforces:
 * 1. 168-Hour (7-Day = 604,800,000 ms) strict return window.
 * 2. Return / cancellation disqualification (INELIGIBLE_RETURN / INELIGIBLE_CANCELLED).
 * 3. Atomic, idempotent reward granting (exactly 50 coins to referrer).
 * 4. Deterministic reward transaction ID (referralReward_{referredUid}).
 * 5. Single notification dispatch for referrer.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const SEVEN_DAYS_MS = 168 * 60 * 60 * 1000; // Exact 604,800,000 ms

/**
 * Robust Timestamp Parser (Handles Firestore Timestamp, JS Date, ISO string, and Epoch millis)
 */
function parseTimestampMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'object') {
    if (ts._seconds !== undefined) return ts._seconds * 1000 + Math.floor((ts._nanoseconds || 0) / 1000000);
    if (ts.seconds !== undefined) return ts.seconds * 1000 + Math.floor((ts.nanoseconds || 0) / 1000000);
  }
  const parsed = new Date(ts).getTime();
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Atomic Referral Reward Processor
 * Safe, idempotent execution with deterministic transaction key
 */
async function processAtomicReferralReward(referralData, orderData) {
  const referredUid = referralData.referredUid;
  const referrerUid = referralData.referrerUid;
  const orderId = orderData.orderId;

  if (!referredUid || !referrerUid || !orderId) {
    console.warn("[Referral Worker] Missing required IDs:", { referredUid, referrerUid, orderId });
    return false;
  }

  // Reject self-referrals
  if (referredUid === referrerUid) {
    console.warn("[Referral Worker] Self-referral detected. Disqualifying:", referredUid);
    await db.collection('referrals').doc(referredUid).set({
      status: 'INELIGIBLE_SELF_REFERRAL',
      rewardStatus: 'INELIGIBLE_SELF_REFERRAL',
      disqualificationReason: 'Self-referral is strictly forbidden',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return false;
  }

  const deterministicTxId = `referralReward_${referredUid}`;
  const txDocRef = db.collection('users').doc(referrerUid).collection('coin_transactions').doc(deterministicTxId);
  const referralDocRef = db.collection('referrals').doc(referredUid);
  const referrerUserRef = db.collection('users').doc(referrerUid);
  const orderDocRef = db.collection('orders').doc(orderId);

  let success = false;

  try {
    await db.runTransaction(async (transaction) => {
      // 1. Transaction Read Phase (All reads MUST happen first)
      const existingTxSnap = await transaction.get(txDocRef);
      if (existingTxSnap.exists) {
        console.log(`[Referral Worker] Transaction ${deterministicTxId} already exists. Idempotent skip.`);
        return;
      }

      const refSnap = await transaction.get(referralDocRef);
      if (refSnap.exists) {
        const rData = refSnap.data();
        if (rData.rewardStatus === 'REWARDED' || rData.status === 'REWARDED') {
          console.log(`[Referral Worker] Referral ${referredUid} already marked REWARDED.`);
          return;
        }
        if (rData.status === 'INELIGIBLE_RETURN' || rData.status === 'INELIGIBLE_CANCELLED') {
          console.log(`[Referral Worker] Referral ${referredUid} is disqualified (${rData.status}).`);
          return;
        }
      }

      const orderSnap = await transaction.get(orderDocRef);
      if (!orderSnap.exists) {
        throw new Error(`Order ${orderId} not found in Firestore.`);
      }
      const ord = orderSnap.data();

      // Check Cancellation FIRST before any delivery or elapsed time checks
      if (ord.status === 'Cancelled') {
        console.log(`[Referral Worker] Order ${orderId} was cancelled. Disqualifying.`);
        transaction.set(referralDocRef, {
          status: 'INELIGIBLE_CANCELLED',
          rewardStatus: 'INELIGIBLE_CANCELLED',
          disqualificationReason: ord.cancellationReason || ord.cancelReason || 'Order was cancelled',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        transaction.set(orderDocRef, {
          referralRewardStatus: 'INELIGIBLE_CANCELLED',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return;
      }

      // Check Return initiation (ANY return initiated permanently disqualifies, even if later rejected/cancelled)
      const hasReturn = Boolean(
        ord.returnInitiatedAt ||
        ord.returnRequested ||
        ord.returnDetails ||
        (Array.isArray(ord.items) && ord.items.some(item => item.returnRequest)) ||
        (refSnap.exists && refSnap.data().returnInitiatedAt)
      );

      if (hasReturn) {
        console.log(`[Referral Worker] Order ${orderId} had return initiated. Disqualifying.`);
        transaction.set(referralDocRef, {
          status: 'INELIGIBLE_RETURN',
          rewardStatus: 'INELIGIBLE_RETURN',
          disqualificationReason: 'Return initiated before 168 hours elapsed',
          returnInitiatedAt: ord.returnInitiatedAt || admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        transaction.set(orderDocRef, {
          referralRewardStatus: 'INELIGIBLE_RETURN',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return;
      }

      // Verify order status is Delivered or Completed
      if (ord.status !== 'Delivered' && ord.status !== 'Completed') {
        console.log(`[Referral Worker] Order ${orderId} is in status ${ord.status}, not Delivered.`);
        return;
      }

      // Verify Delivered timestamp
      const deliveredTime = parseTimestampMillis(ord.deliveredAt);
      if (!deliveredTime) {
        console.log(`[Referral Worker] Order ${orderId} has no valid deliveredAt timestamp.`);
        return;
      }

      // Exact 168-hour (604,800,000 ms) window check
      const now = Date.now();
      if (now - deliveredTime < SEVEN_DAYS_MS) {
        console.log(`[Referral Worker] Order ${orderId} 168-hour window has not elapsed yet (${now - deliveredTime}ms / ${SEVEN_DAYS_MS}ms).`);
        return;
      }

      const referrerSnap = await transaction.get(referrerUserRef);
      let currentCoins = 0;
      if (referrerSnap.exists) {
        const uData = referrerSnap.data();
        currentCoins = Number(uData.coins !== undefined ? uData.coins : (uData.walletCoins || 0));
      }
      const newCoins = currentCoins + 50;

      // 2. Transaction Write Phase (Atomic Execution)
      // A. Immutable coin ledger record
      transaction.set(txDocRef, {
        uid: referrerUid,
        type: 'REFERRAL_REWARD',
        amount: 50,
        referralCode: referralData.referralCode || null,
        referredUid: referredUid,
        orderId: orderId,
        status: 'COMPLETED',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // B. Update referrer authoritative balance
      transaction.set(referrerUserRef, {
        coins: newCoins,
        walletCoins: newCoins,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // C. Update referral tracking record to REWARDED
      transaction.set(referralDocRef, {
        status: 'REWARDED',
        rewardStatus: 'REWARDED',
        rewardCoins: 50,
        rewardedAt: admin.firestore.FieldValue.serverTimestamp(),
        rewardTransactionId: deterministicTxId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // D. Update order referralRewardStatus
      transaction.set(orderDocRef, {
        referralRewardStatus: 'PROCESSED',
        referralRewardProcessed: true,
        referralRewardProcessedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // E. Update referred user document referralRewardStatus
      const referredUserDocRef = db.collection('users').doc(referredUid);
      transaction.set(referredUserDocRef, {
        referralRewardStatus: 'REWARDED',
        rewardTransactionId: deterministicTxId,
        rewardedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      success = true;
    });

    if (success) {
      console.log(`[Referral Worker] Successfully awarded 50 coins to ${referrerUid} for referred user ${referredUid}`);
      // Single in-app notification to referrer (idempotent key)
      const notifDocRef = db.collection('users').doc(referrerUid).collection('notifications').doc(`notif_referral_${referredUid}`);
      await notifDocRef.set({
        title: "🎁 Referral Reward Credited!",
        message: "You earned 50 Buyero Coins because your referred user completed their first qualifying order!",
        type: "REFERRAL_REWARD",
        coinsEarned: 50,
        referredUid: referredUid,
        orderId: orderId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        read: false
      }, { merge: true });
    }
  } catch (err) {
    console.error(`[Referral Worker Error for ${referredUid}]`, err);
  }

  return success;
}

/**
 * Scheduled Cloud Function (Runs every 15 minutes)
 * Scans all pending referrals with delivered orders and processes eligible ones
 * Pure server-side execution: operates completely independent of frontend/admin state
 */
exports.processReferralRewardsJob = functions.pubsub.schedule('every 15 minutes').onRun(async (context) => {
  console.log("[Scheduled Job] Starting 168-hour referral reward eligibility scan...");

  try {
    const pendingSnap = await db.collection('referrals')
      .where('rewardStatus', 'in', ['PENDING', 'WAITING_FOR_FIRST_ORDER', 'ORDER_DELIVERED_WAITING_168H'])
      .get();

    console.log(`[Scheduled Job] Found ${pendingSnap.size} potentially active/pending referral records.`);

    for (const doc of pendingSnap.docs) {
      const referral = doc.data();
      if (!referral.firstOrderId) {
        continue; // Still waiting for first order placement
      }

      if (referral.referredUid === referral.referrerUid) {
        continue; // Self-referral forbidden
      }

      if (referral.status === 'INELIGIBLE_RETURN' || referral.status === 'INELIGIBLE_CANCELLED') {
        continue; // Disqualified
      }

      const orderSnap = await db.collection('orders').doc(referral.firstOrderId).get();
      if (!orderSnap.exists) {
        continue;
      }
      const order = orderSnap.data();

      // Check cancellation
      if (order.status === 'Cancelled') {
        console.log(`[Scheduled Job] Order #${order.orderId} was cancelled. Disqualifying referral ${referral.referredUid}.`);
        await db.collection('referrals').doc(referral.referredUid).set({
          status: 'INELIGIBLE_CANCELLED',
          rewardStatus: 'INELIGIBLE_CANCELLED',
          disqualificationReason: order.cancellationReason || order.cancelReason || 'Order was cancelled',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        continue;
      }

      // Check return initiation
      const hasReturn = Boolean(
        order.returnInitiatedAt ||
        order.returnRequested ||
        order.returnDetails ||
        (Array.isArray(order.items) && order.items.some(item => item.returnRequest)) ||
        referral.returnInitiatedAt
      );

      if (hasReturn) {
        console.log(`[Scheduled Job] Order #${order.orderId} had return initiated. Disqualifying referral ${referral.referredUid}.`);
        await db.collection('referrals').doc(referral.referredUid).set({
          status: 'INELIGIBLE_RETURN',
          rewardStatus: 'INELIGIBLE_RETURN',
          disqualificationReason: 'Return initiated before 168-hour window elapsed',
          returnInitiatedAt: order.returnInitiatedAt || admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        continue;
      }

      // Check if delivered and exact 168 hours (604,800,000 ms) have elapsed
      if ((order.status === 'Delivered' || order.status === 'Completed') && order.deliveredAt) {
        const deliveredTime = parseTimestampMillis(order.deliveredAt);
        const now = Date.now();
        if (deliveredTime > 0 && (now - deliveredTime >= SEVEN_DAYS_MS)) {
          console.log(`[Scheduled Job] Referral ${referral.referredUid} order #${order.orderId} passed 168 hours (${now - deliveredTime}ms >= ${SEVEN_DAYS_MS}ms). Processing reward...`);
          await processAtomicReferralReward(referral, order);

          // Mark order Completed & profit realized if still in Delivered status
          if (order.status === 'Delivered') {
            await db.collection('orders').doc(order.orderId).set({
              status: 'Completed',
              completedAt: admin.firestore.FieldValue.serverTimestamp(),
              profitRealized: true,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            if (order.userId) {
              await db.collection('users').doc(order.userId).collection('orders').doc(order.orderId).set({
                status: 'Completed',
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              }, { merge: true }).catch(() => {});
            }
          }
        }
      }
    }

    // Additional scan: Finalize ALL delivered orders older than 168 hours without return
    const deliveredOrdersSnap = await db.collection('orders')
      .where('status', '==', 'Delivered')
      .get();

    const now = Date.now();
    for (const doc of deliveredOrdersSnap.docs) {
      const ord = doc.data();
      if (!ord || !ord.deliveredAt) continue;

      const delivTime = parseTimestampMillis(ord.deliveredAt);
      if (delivTime > 0 && (now - delivTime >= SEVEN_DAYS_MS)) {
        const hasReturn = Boolean(
          ord.returnInitiatedAt ||
          ord.returnRequested ||
          ord.returnDetails ||
          (Array.isArray(ord.items) && ord.items.some(item => item.returnRequest))
        );

        if (!hasReturn && ord.status !== 'Cancelled') {
          console.log(`[Scheduled Job] Order #${ord.orderId} passed 168h return window. Auto-finalizing to Completed...`);
          await db.collection('orders').doc(ord.orderId).set({
            status: 'Completed',
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
            profitRealized: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });

          if (ord.userId) {
            await db.collection('users').doc(ord.userId).collection('orders').doc(ord.orderId).set({
              status: 'Completed',
              completedAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true }).catch(() => {});
          }
        }
      }
    }

    console.log("[Scheduled Job] 168-hour referral eligibility scan completed successfully.");
    return null;
  } catch (error) {
    console.error("[Scheduled Job Error]", error);
    return null;
  }
});

/**
 * Firestore Trigger on Order Write
 * Reacts to order updates (Delivered, Cancelled, Return Initiated)
 */
exports.onOrderWritten = functions.firestore.document('orders/{orderId}').onWrite(async (change, context) => {
  const orderId = context.params.orderId;
  if (!change.after.exists) return null; // Deleted order

  const order = change.after.data();
  const userId = order.userId;

  // 1. FCM Notification: New Order created -> Alert Admin Devices
  if (!change.before.exists) {
    try {
      const adminTokens = await getAdminTokens();
      if (adminTokens.length > 0) {
        await sendFCMToTokens(adminTokens, {
          title: "🛍️ New Order Received!",
          body: `Order #${order.orderId || orderId} from ${order.customerName || order.userName || 'Customer'} (₹${order.total || order.payableAmount || 0})`,
          url: "/admin/index.html",
          data: {
            type: "NEW_ORDER",
            orderId: String(order.orderId || orderId)
          }
        });
      }
    } catch (e) {
      console.warn("[FCM New Order Alert Error]", e);
    }
  }

  // 2. FCM Notification: Order Status Changed -> Alert Customer Device
  if (change.before.exists && userId) {
    const prevOrder = change.before.data();
    if (prevOrder.status !== order.status) {
      try {
        const userTokens = await getUserTokens(userId);
        if (userTokens.length > 0) {
          await sendFCMToTokens(userTokens, {
            title: `📦 Order ${order.status}!`,
            body: `Your order #${order.orderId || orderId} status is now ${order.status}.`,
            url: "/client/index.html",
            data: {
              type: "ORDER_STATUS_UPDATE",
              orderId: String(order.orderId || orderId),
              status: String(order.status)
            }
          });
        }
      } catch (e) {
        console.warn("[FCM Order Status Alert Error]", e);
      }
    }
  }

  if (!userId) return null;

  try {
    const refDocRef = db.collection('referrals').doc(userId);
    const refSnap = await refDocRef.get();

    if (!refSnap.exists) return null; // User wasn't referred
    const refData = refSnap.data();

    // First-order-only protection:
    // If a firstOrderId was already recorded and it's NOT this order, ignore subsequent orders!
    if (refData.firstOrderId && refData.firstOrderId !== orderId) {
      return null;
    }

    const updates = {};

    // If firstOrderId is not yet attached, lock this order as the first qualifying order!
    if (!refData.firstOrderId) {
      updates.firstOrderId = orderId;
      updates.firstOrderCreatedAt = order.createdAt || admin.firestore.FieldValue.serverTimestamp();
      updates.status = 'FIRST_ORDER_PLACED';
    }

    // 1. Order Cancelled
    if (order.status === 'Cancelled') {
      if (refData.rewardStatus !== 'REWARDED') {
        updates.status = 'INELIGIBLE_CANCELLED';
        updates.rewardStatus = 'INELIGIBLE_CANCELLED';
        updates.cancellationAt = admin.firestore.FieldValue.serverTimestamp();
        updates.disqualificationReason = order.cancellationReason || order.cancelReason || 'Order was cancelled';
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await refDocRef.set(updates, { merge: true });

        // Update user document
        await db.collection('users').doc(userId).set({
          referralRewardStatus: 'INELIGIBLE_CANCELLED',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // Update order record
        await db.collection('orders').doc(orderId).set({
          referralRewardStatus: 'INELIGIBLE_CANCELLED',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // Backend coin refund if applicable
        if (order.coinsDiscount && order.coinsDiscount > 0 && !order.coinsRefunded) {
          const refundAmt = Number(order.coinsDiscount);
          const userDocRef = db.collection('users').doc(userId);
          const refundTxRef = userDocRef.collection('coin_transactions').doc(`order_${orderId}_refund`);

          await db.runTransaction(async (t) => {
            const txSnap = await t.get(refundTxRef);
            if (txSnap.exists) return;

            const uSnap = await t.get(userDocRef);
            let uCoins = 0;
            if (uSnap.exists) {
              const uData = uSnap.data();
              uCoins = Number(uData.coins !== undefined ? uData.coins : (uData.walletCoins || 0));
            }
            const restoredCoins = uCoins + refundAmt;

            t.set(refundTxRef, {
              type: 'ORDER_REFUND',
              amount: refundAmt,
              orderId: orderId,
              uid: userId,
              status: 'COMPLETED',
              createdAt: admin.firestore.FieldValue.serverTimestamp()
            });

            t.set(userDocRef, {
              coins: restoredCoins,
              walletCoins: restoredCoins,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            t.set(db.collection('orders').doc(orderId), {
              coinsRefunded: true,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
          }).catch(err => console.warn("[Cancel Coin Refund Error]", err));
        }
      }
      return null;
    }

    // 2. Return Initiated (Permanent disqualification even if later rejected or cancelled)
    const hasReturn = Boolean(
      order.returnInitiatedAt ||
      order.returnRequested ||
      order.returnDetails ||
      (Array.isArray(order.items) && order.items.some(item => item.returnRequest))
    );

    if (hasReturn) {
      if (refData.rewardStatus !== 'REWARDED') {
        updates.status = 'INELIGIBLE_RETURN';
        updates.rewardStatus = 'INELIGIBLE_RETURN';
        updates.returnInitiatedAt = order.returnInitiatedAt || admin.firestore.FieldValue.serverTimestamp();
        updates.disqualificationReason = 'Return requested before 168-hour return window elapsed';
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await refDocRef.set(updates, { merge: true });

        // Update user document
        await db.collection('users').doc(userId).set({
          referralRewardStatus: 'INELIGIBLE_RETURN',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // Update order record
        await db.collection('orders').doc(orderId).set({
          referralRewardStatus: 'INELIGIBLE_RETURN',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
      return null;
    }

    // 3. Order Delivered -> Record 168h clock
    if ((order.status === 'Delivered' || order.status === 'Completed') && order.deliveredAt) {
      const deliveredTime = parseTimestampMillis(order.deliveredAt);
      if (deliveredTime > 0) {
        const eligibilityAt = new Date(deliveredTime + SEVEN_DAYS_MS).toISOString();

        if (refData.status === 'WAITING_FOR_FIRST_ORDER' || refData.status === 'FIRST_ORDER_PLACED') {
          updates.firstOrderId = orderId;
          updates.firstOrderDeliveredAt = order.deliveredAt;
          updates.eligibilityAt = eligibilityAt;
          updates.status = 'ORDER_DELIVERED_WAITING_168H';
          updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
          await refDocRef.set(updates, { merge: true });
        }

        // If already 168 hours have passed, process reward & mark order Completed
        if (Date.now() - deliveredTime >= SEVEN_DAYS_MS) {
          if (refData.rewardStatus === 'PENDING') {
            await processAtomicReferralReward(refData, order);
          }
          if (order.status === 'Delivered') {
            await db.collection('orders').doc(orderId).set({
              status: 'Completed',
              completedAt: admin.firestore.FieldValue.serverTimestamp(),
              profitRealized: true,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            await db.collection('users').doc(userId).collection('orders').doc(orderId).set({
              status: 'Completed',
              completedAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true }).catch(() => {});
          }
        }
      }
    }
  } catch (e) {
    console.error("[onOrderWritten Trigger Error]", e);
  }

  return null;
});

/**
 * ============================================================================
 * FIREBASE CLOUD MESSAGING (FCM) NOTIFICATION ENGINE & TRIGGERS
 * VAPID Sender ID: 133729371654
 * ============================================================================
 */

/**
 * Robust Multicast FCM Dispatcher
 */
async function sendFCMToTokens(tokens, { title, body, icon, image, url, data = {} }) {
  if (!tokens || !Array.isArray(tokens) || tokens.length === 0) return { successCount: 0, failureCount: 0 };
  const uniqueTokens = [...new Set(tokens.filter(t => t && typeof t === 'string' && t.trim().length > 10))];
  if (uniqueTokens.length === 0) return { successCount: 0, failureCount: 0 };

  const finalUrl = url || '/';
  const finalIcon = icon || 'https://buyero-68abd.web.app/assets/icons/icon-192x192.png';

  const messagePayload = {
    notification: {
      title: title || 'Buyero Notification',
      body: body || '',
      imageUrl: image || undefined
    },
    data: {
      title: title || 'Buyero Notification',
      body: body || '',
      url: finalUrl,
      imageUrl: image || '',
      ...data
    },
    webpush: {
      notification: {
        title: title || 'Buyero Notification',
        body: body || '',
        icon: finalIcon,
        image: image || undefined,
        badge: 'https://buyero-68abd.web.app/assets/icons/icon-192x192.png',
        vibrate: [200, 100, 200],
        requireInteraction: false
      },
      fcmOptions: {
        link: finalUrl
      }
    },
    tokens: uniqueTokens
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(messagePayload);
    console.log(`[FCM Engine] Multicast result: ${response.successCount} sent, ${response.failureCount} failed.`);

    // Clean stale or invalid tokens automatically
    if (response.failureCount > 0) {
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errCode = resp.error?.code;
          if (
            errCode === 'messaging/invalid-registration-token' ||
            errCode === 'messaging/registration-token-not-registered'
          ) {
            const badToken = uniqueTokens[idx];
            db.collection('fcmTokens').doc(badToken).delete().catch(() => {});
            db.collection('admin_fcm_tokens').doc(badToken).delete().catch(() => {});
          }
        }
      });
    }

    return response;
  } catch (err) {
    console.error("[FCM Engine Error]", err);
    return { successCount: 0, failureCount: uniqueTokens.length, error: err.message };
  }
}

/**
 * Fetch all registered Administrator device tokens
 */
async function getAdminTokens() {
  const tokenList = [];
  try {
    const adminSnap = await db.collection('admin_fcm_tokens').get();
    adminSnap.forEach(d => {
      const t = d.data()?.token || d.id;
      if (t && typeof t === 'string') tokenList.push(t);
    });

    const roleSnap = await db.collection('fcmTokens').where('role', '==', 'admin').get();
    roleSnap.forEach(d => {
      const t = d.data()?.token || d.id;
      if (t && typeof t === 'string') tokenList.push(t);
    });
  } catch (e) {
    console.warn("[getAdminTokens error]", e);
  }
  return [...new Set(tokenList)];
}

/**
 * Fetch all device tokens for a specific customer
 */
async function getUserTokens(userId) {
  if (!userId) return [];
  const tokenList = [];
  try {
    // 1. Check user profile document
    const uDoc = await db.collection('users').doc(userId).get();
    if (uDoc.exists) {
      const u = uDoc.data();
      if (u.fcmToken) tokenList.push(u.fcmToken);
      if (Array.isArray(u.fcmTokens)) u.fcmTokens.forEach(t => tokenList.push(t));
    }

    // 2. Check fcmTokens collection
    const fcmSnap = await db.collection('fcmTokens').where('userId', '==', userId).get();
    fcmSnap.forEach(d => {
      const t = d.data()?.token || d.id;
      if (t) tokenList.push(t);
    });
  } catch (e) {
    console.warn("[getUserTokens error]", e);
  }
  return [...new Set(tokenList)];
}

/**
 * Fetch all customer device tokens (excluding admins)
 */
async function getAllCustomerTokens() {
  const tokenList = [];
  try {
    const snap = await db.collection('fcmTokens').get();
    snap.forEach(d => {
      const data = d.data();
      if (data && data.role !== 'admin') {
        const t = data.token || d.id;
        if (t) tokenList.push(t);
      }
    });
  } catch (e) {
    console.warn("[getAllCustomerTokens error]", e);
  }
  return [...new Set(tokenList)];
}

/**
 * 6. FCM Trigger: Coin Reward Added -> Notify Customer
 */
exports.onCoinTransactionCreated = functions.firestore
  .document('users/{userId}/coin_transactions/{txId}')
  .onCreate(async (snap, context) => {
    const userId = context.params.userId;
    const tx = snap.data();
    if (!tx || !tx.amount || tx.amount <= 0) return null;

    try {
      const tokens = await getUserTokens(userId);
      if (tokens.length > 0) {
        await sendFCMToTokens(tokens, {
          title: "🪙 Buyero Coins Credited!",
          body: `You received +${tx.amount} Buyero Coins! ${tx.note || (tx.type === 'REFERRAL_REWARD' ? 'Referral reward' : 'Wallet reward')}`,
          url: "/client/index.html",
          data: {
            type: "COIN_REWARD",
            amount: String(tx.amount),
            txId: context.params.txId
          }
        });
      }
    } catch (err) {
      console.warn("[onCoinTransactionCreated FCM error]", err);
    }
    return null;
  });

/**
 * 7. FCM Trigger: Chat Message Created -> Notify the opposite party
 */
exports.onSupportChatMessageCreated = functions.firestore
  .document('support_chats/{msgId}')
  .onCreate(async (snap, context) => {
    const msg = snap.data();
    if (!msg) return null;

    try {
      if (msg.isAdmin === false) {
        // Customer sent a message -> Notify Admin Devices
        const adminTokens = await getAdminTokens();
        if (adminTokens.length > 0) {
          await sendFCMToTokens(adminTokens, {
            title: `💬 New Message: ${msg.sender || msg.userName || 'Customer'}`,
            body: msg.text || 'Customer sent an attachment.',
            url: "/admin/index.html",
            data: {
              type: "CHAT_MESSAGE_ADMIN",
              chatId: context.params.msgId,
              userId: msg.userId || ''
            }
          });
        }
      } else if (msg.isAdmin === true && msg.userId) {
        // Admin replied -> Notify Customer Device
        const customerTokens = await getUserTokens(msg.userId);
        if (customerTokens.length > 0) {
          await sendFCMToTokens(customerTokens, {
            title: "💬 Buyero Support Team",
            body: msg.text || 'You received a new reply from support.',
            url: "/client/index.html",
            data: {
              type: "CHAT_MESSAGE_CUSTOMER",
              chatId: context.params.msgId
            }
          });
        }
      }
    } catch (err) {
      console.warn("[onSupportChatMessageCreated FCM error]", err);
    }
    return null;
  });

/**
 * 8. FCM Trigger: Admin Offer Broadcast -> Push to All Customers
 */
exports.onOfferBroadcastCreated = functions.firestore
  .document('offer_broadcasts/{broadcastId}')
  .onCreate(async (snap, context) => {
    const broadcast = snap.data();
    if (!broadcast) return null;

    console.log(`[FCM Broadcast] Processing offer broadcast ${context.params.broadcastId}...`);

    try {
      const allTokens = await getAllCustomerTokens();
      if (allTokens.length === 0) {
        await snap.ref.set({
          status: 'NO_TOKENS_FOUND',
          sentCount: 0,
          processedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return null;
      }

      // Chunk tokens into batches of 500 (FCM multicast limit)
      const chunkSize = 500;
      let totalSent = 0;
      let totalFailed = 0;

      for (let i = 0; i < allTokens.length; i += chunkSize) {
        const chunk = allTokens.slice(i, i + chunkSize);
        const res = await sendFCMToTokens(chunk, {
          title: broadcast.title || '🎉 Special Offer from Buyero!',
          body: broadcast.message || 'Check out our latest deals and discounts.',
          image: broadcast.imageUrl || undefined,
          url: broadcast.url || '/client/index.html',
          data: {
            type: "OFFER_BROADCAST",
            broadcastId: context.params.broadcastId
          }
        });
        totalSent += res.successCount || 0;
        totalFailed += res.failureCount || 0;
      }

      await snap.ref.set({
        status: 'COMPLETED',
        totalRecipients: allTokens.length,
        sentCount: totalSent,
        failureCount: totalFailed,
        processedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      console.log(`[FCM Broadcast] Successfully dispatched to ${totalSent} devices.`);
    } catch (err) {
      console.error("[onOfferBroadcastCreated Error]", err);
      await snap.ref.set({
        status: 'FAILED',
        error: err.message,
        processedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    return null;
  });

/**
 * SECURE IMGUR IMAGE UPLOAD PROXY
 * Cloud Function to safely upload product images to Imgur API v3
 * Keeps API credentials confidential on server side
 */
exports.uploadImgurImage = functions.https.onRequest(async (req, res) => {
  // Setup permissive CORS for Admin Panel WebView
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method Not Allowed. Send POST request.' });
    return;
  }

  try {
    const { imageBase64, clientId: clientProvidedId, name, title } = req.body || {};
    if (!imageBase64) {
      res.status(400).json({ success: false, error: 'Missing imageBase64 in request body.' });
      return;
    }

    // Clean data URL prefix if present (e.g. data:image/jpeg;base64,)
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z+]+;base64,/, '').trim();

    // Priority: environment secret -> functions config -> client-provided admin ID
    const effectiveClientId = process.env.IMGUR_CLIENT_ID ||
      (functions.config().imgur && functions.config().imgur.client_id) ||
      clientProvidedId;

    if (!effectiveClientId) {
      res.status(400).json({
        success: false,
        error: 'Imgur Client ID is not configured. Please configure it in Admin Settings or set IMGUR_CLIENT_ID environment variable.'
      });
      return;
    }

    // Call Imgur API v3
    const imgurResponse = await fetch('https://api.imgur.com/3/image', {
      method: 'POST',
      headers: {
        'Authorization': `Client-ID ${effectiveClientId.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        image: cleanBase64,
        type: 'base64',
        name: name || 'buyero_product',
        title: title || 'Buyero Product Image'
      })
    });

    const data = await imgurResponse.json();

    if (!imgurResponse.ok || !data.success) {
      const status = imgurResponse.status;
      let userFriendlyError = (data.data && data.data.error) || 'Imgur upload failed.';

      // Check quota limits
      if (status === 429) {
        userFriendlyError = 'Imgur Free Tier quota limit has been reached. Please wait or use Direct Image URL.';
      } else if (status === 403 || status === 401) {
        userFriendlyError = 'Invalid Imgur Client ID. Please verify your credentials in Admin Settings.';
      }

      console.warn('[uploadImgurImage] Imgur rejected upload:', { status, error: userFriendlyError });
      res.status(status).json({
        success: false,
        status: status,
        error: userFriendlyError
      });
      return;
    }

    // Imgur success: direct URL is in data.data.link
    const directUrl = data.data.link;
    console.log('[uploadImgurImage] Successfully uploaded to Imgur:', directUrl);

    res.json({
      success: true,
      link: directUrl,
      id: data.data.id,
      deletehash: data.data.deletehash,
      type: data.data.type,
      width: data.data.width,
      height: data.data.height,
      size: data.data.size
    });
  } catch (err) {
    console.error('[uploadImgurImage Error]', err);
    res.status(500).json({
      success: false,
      error: 'Network error or internal server exception: ' + (err.message || 'Unknown error')
    });
  }
});


