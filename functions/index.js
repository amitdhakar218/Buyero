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
const SEVEN_DAYS_MS = 168 * 60 * 60 * 1000; // 604,800,000 ms

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

      // Verify order eligibility conditions
      if (ord.status !== 'Delivered' && ord.status !== 'Completed') {
        console.log(`[Referral Worker] Order ${orderId} is in status ${ord.status}, not Delivered.`);
        return;
      }

      if (!ord.deliveredAt) {
        console.log(`[Referral Worker] Order ${orderId} has no deliveredAt timestamp.`);
        return;
      }

      const deliveredTime = new Date(ord.deliveredAt).getTime();
      const now = Date.now();
      if (now - deliveredTime < SEVEN_DAYS_MS) {
        console.log(`[Referral Worker] Order ${orderId} 168-hour window has not elapsed yet.`);
        return;
      }

      const hasReturn = Boolean(
        (ord.returnDetails && ord.returnDetails.status && ord.returnDetails.status !== 'Rejected') ||
        (ord.items && ord.items.some(item => item.returnRequest && item.returnRequest.status !== 'Rejected'))
      );

      if (hasReturn) {
        console.log(`[Referral Worker] Order ${orderId} had return initiated. Disqualifying.`);
        transaction.set(referralDocRef, {
          status: 'INELIGIBLE_RETURN',
          rewardStatus: 'INELIGIBLE_RETURN',
          disqualificationReason: 'Return initiated before 168 hours elapsed',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        transaction.set(orderDocRef, {
          referralRewardStatus: 'INELIGIBLE_RETURN',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return;
      }

      if (ord.status === 'Cancelled') {
        console.log(`[Referral Worker] Order ${orderId} was cancelled. Disqualifying.`);
        transaction.set(referralDocRef, {
          status: 'INELIGIBLE_CANCELLED',
          rewardStatus: 'INELIGIBLE_CANCELLED',
          disqualificationReason: 'Order was cancelled',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        transaction.set(orderDocRef, {
          referralRewardStatus: 'INELIGIBLE_CANCELLED',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
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

      const orderSnap = await db.collection('orders').doc(referral.firstOrderId).get();
      if (!orderSnap.exists) {
        continue;
      }
      const order = orderSnap.data();

      // Check if delivered and exact 168 hours (604,800,000 ms) have elapsed
      if ((order.status === 'Delivered' || order.status === 'Completed') && order.deliveredAt) {
        const deliveredTime = new Date(order.deliveredAt).getTime();
        const now = Date.now();
        if (now - deliveredTime >= SEVEN_DAYS_MS) {
          console.log(`[Scheduled Job] Referral ${referral.referredUid} order #${order.orderId} passed 168 hours. Processing reward...`);
          await processAtomicReferralReward(referral, order);
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
  if (!userId) return null;

  try {
    const refDocRef = db.collection('referrals').doc(userId);
    const refSnap = await refDocRef.get();

    if (!refSnap.exists) return null; // User wasn't referred
    const refData = refSnap.data();

    // Check if this order is the first order
    if (refData.firstOrderId && refData.firstOrderId !== orderId) {
      return null; // Not the first order
    }

    const updates = {};

    // 1. Order Cancelled
    if (order.status === 'Cancelled') {
      if (refData.rewardStatus !== 'REWARDED') {
        updates.status = 'INELIGIBLE_CANCELLED';
        updates.rewardStatus = 'INELIGIBLE_CANCELLED';
        updates.cancellationAt = admin.firestore.FieldValue.serverTimestamp();
        updates.disqualificationReason = order.cancellationReason || 'Order was cancelled';
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await refDocRef.set(updates, { merge: true });
      }
      return null;
    }

    // 2. Return Initiated
    const hasReturn = Boolean(
      (order.returnDetails && order.returnDetails.status && order.returnDetails.status !== 'Rejected') ||
      (order.items && order.items.some(item => item.returnRequest && item.returnRequest.status !== 'Rejected'))
    );

    if (hasReturn) {
      if (refData.rewardStatus !== 'REWARDED') {
        updates.status = 'INELIGIBLE_RETURN';
        updates.rewardStatus = 'INELIGIBLE_RETURN';
        updates.returnInitiatedAt = admin.firestore.FieldValue.serverTimestamp();
        updates.disqualificationReason = 'Return requested before 168-hour return window elapsed';
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await refDocRef.set(updates, { merge: true });
      }
      return null;
    }

    // 3. Order Delivered -> Record 168h clock
    if (order.status === 'Delivered' && order.deliveredAt) {
      const deliveredTime = new Date(order.deliveredAt).getTime();
      const eligibilityAt = new Date(deliveredTime + SEVEN_DAYS_MS).toISOString();

      if (refData.status === 'WAITING_FOR_FIRST_ORDER' || refData.status === 'FIRST_ORDER_PLACED') {
        updates.firstOrderId = orderId;
        updates.firstOrderDeliveredAt = order.deliveredAt;
        updates.eligibilityAt = eligibilityAt;
        updates.status = 'ORDER_DELIVERED_WAITING_168H';
        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await refDocRef.set(updates, { merge: true });
      }

      // If already 168 hours have passed (e.g. historical data backfill), process reward!
      if (Date.now() - deliveredTime >= SEVEN_DAYS_MS && refData.rewardStatus === 'PENDING') {
        await processAtomicReferralReward(refData, order);
      }
    }
  } catch (e) {
    console.error("[onOrderWritten Trigger Error]", e);
  }

  return null;
});
