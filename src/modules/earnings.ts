export interface EarningOp {
  seq: number;
  timestamp: string;
  type: string;
  blurtVal: number;
  bpVal: number;
  totalVal: number;
  permlink: string;
}

export interface DailyStat {
  date: string;
  author: number;
  curation: number;
  benefactor: number;
  total: number;
}

export interface EarningStats {
  author: number;
  curation: number;
  benefactor: number;
  claimed: number;
  total: number;
  avgPerDay: number;
  range: string;
}

export function processHistory(history: any[], ratio: number): { ops: EarningOp[], stats: EarningStats, daily: DailyStat[] } {
  let author = 0, curation = 0, benefactor = 0, claimed = 0;
  const ops: EarningOp[] = [];
  const dailyMap: Record<string, DailyStat> = {};
  
  // Sort history by sequence to ensure chronological processing
  const sortedHistory = [...history].sort((a, b) => {
    const seqA = Array.isArray(a) ? a[0] : (a.seq || 0);
    const seqB = Array.isArray(b) ? b[0] : (b.seq || 0);
    return seqA - seqB;
  });

  let minTs = '', maxTs = '';

  for (const rawItem of sortedHistory) {
    const item = Array.isArray(rawItem) ? rawItem[1] : rawItem;
    const seq = Array.isArray(rawItem) ? rawItem[0] : (item.seq || 0);
    const { op, timestamp } = item;
    const [type, details] = op;

    if (!minTs) minTs = timestamp;
    maxTs = timestamp;

    let blurtVal = 0, vestsVal = 0, isReward = false, permlink = '-';
    if (type === 'author_reward') {
      blurtVal = parseFloat(details.blurt_payout);
      vestsVal = parseFloat(details.vesting_payout);
      permlink = details.permlink;
      isReward = true;
    } else if (type === 'curation_reward') {
      vestsVal = parseFloat(details.reward);
      permlink = `${details.comment_author}/${details.comment_permlink}`;
      isReward = true;
    } else if (type === 'comment_benefactor_reward') {
      blurtVal = parseFloat(details.blurt_payout);
      vestsVal = parseFloat(details.vesting_payout);
      permlink = `${details.author}/${details.permlink}`;
      isReward = true;
    } else if (type === 'claim_reward_balance') {
      blurtVal = parseFloat(details.reward_blurt);
      vestsVal = parseFloat(details.reward_vests);
      permlink = 'Claim Wallet';
      isReward = true;
    }

    if (isReward) {
      const bpVal = vestsVal * ratio;
      const totalVal = blurtVal + bpVal;
      const date = timestamp.split('T')[0];

      if (!dailyMap[date]) dailyMap[date] = { date, author: 0, curation: 0, benefactor: 0, total: 0 };

      if (type === 'author_reward') {
        author += totalVal;
        dailyMap[date].author += totalVal;
      } else if (type === 'curation_reward') {
        curation += totalVal;
        dailyMap[date].curation += totalVal;
      } else if (type === 'comment_benefactor_reward') {
        benefactor += totalVal;
        dailyMap[date].benefactor += totalVal;
      } else if (type === 'claim_reward_balance') {
        claimed += totalVal;
      }

      dailyMap[date].total += totalVal;
      ops.push({ seq, timestamp, type, blurtVal, bpVal, totalVal, permlink });
    }
  }

  const startSec = new Date(minTs + 'Z').getTime() / 1000;
  const endSec = new Date(maxTs + 'Z').getTime() / 1000;
  const days = Math.max((endSec - startSec) / 86400, 0.0001);
  const totalGenerated = author + curation + benefactor;

  return {
    ops,
    daily: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)),
    stats: {
      author, curation, benefactor, claimed,
      total: totalGenerated,
      avgPerDay: totalGenerated / days,
      range: `${minTs.replace('T', ' ')} - ${maxTs.replace('T', ' ')}`
    }
  };
}
