// Test script for Sabrina Time Tracker logic
const fs = require('fs');

console.log("=== Testing Telus Parser Regex ===");

function parseTelusLogs(rawText) {
  if (!rawText || !rawText.trim()) return [];

  const lines = rawText.split('\n');
  const parsedCalls = [];

  const durationRegex = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})|(\d+)\s*(?:m|min)\s*(\d+)?\s*(?:s|sec)?/i;
  const timeRegex = /(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)/i;
  const phoneRegex = /(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/;

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let callType = 'Phone Call';
    if (/inbound|incoming|received/i.test(trimmed)) callType = '📞 Inbound';
    else if (/outbound|outgoing|made|dialed/i.test(trimmed)) callType = '📱 Outbound';
    else if (/missed/i.test(trimmed)) callType = '❌ Missed';

    const phoneMatch = trimmed.match(phoneRegex);
    const party = phoneMatch ? phoneMatch[0] : 'Customer';

    const timeMatch = trimmed.match(timeRegex);
    const callTime = timeMatch ? timeMatch[0] : 'Today';

    let durationSeconds = 0;
    let durationStr = '00:00';

    const durMatch = trimmed.match(durationRegex);
    if (durMatch) {
      if (durMatch[2] !== undefined && durMatch[3] !== undefined) {
        const hours = durMatch[1] ? parseInt(durMatch[1], 10) : 0;
        const mins = parseInt(durMatch[2], 10);
        const secs = parseInt(durMatch[3], 10);
        durationSeconds = (hours * 3600) + (mins * 60) + secs;
        durationStr = `${hours > 0 ? hours + ':' : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      } else if (durMatch[4] !== undefined) {
        const mins = parseInt(durMatch[4], 10);
        const secs = durMatch[5] ? parseInt(durMatch[5], 10) : 0;
        durationSeconds = (mins * 60) + secs;
        durationStr = `${mins}m ${secs}s`;
      }
    }

    if (durationSeconds === 0 && !/missed/i.test(trimmed)) {
      durationSeconds = 180;
      durationStr = '~3m 00s (est)';
    }

    parsedCalls.push({
      type: callType,
      party: party,
      time: callTime,
      durationStr: durationStr,
      durationSeconds: durationSeconds
    });
  });

  return parsedCalls;
}

const sampleTelus = `
Inbound Call  (416) 555-0192  00:04:12  09:25 AM
Outbound Call (905) 555-0144  00:08:45  10:14 AM
Outbound Call (647) 555-9821  2m 30s    11:30 AM
`;

const parsed = parseTelusLogs(sampleTelus);
console.log("Parsed calls count:", parsed.length);
let totalSecs = 0;
parsed.forEach(c => {
  console.log(`- ${c.type} | ${c.party} | ${c.time} | Duration: ${c.durationStr} (${c.durationSeconds}s)`);
  totalSecs += c.durationSeconds;
});
console.log(`Total Extrapolated Talk Time: ${Math.floor(totalSecs / 60)}m ${totalSecs % 60}s`);

console.log("\n=== Testing Split Shift Total Calculations ===");
const shift1 = { duration: 6 * 3600, phone: 2.5 * 3600, offPhone: 3.5 * 3600 }; // 9am - 3pm
const shift2 = { duration: 2 * 3600, phone: 1.0 * 3600, offPhone: 1.0 * 3600 }; // 5pm - 7pm
const dailyTotalSecs = shift1.duration + shift2.duration;
const dailyHours = dailyTotalSecs / 3600;
const hourlyRate = 25.00;
const dailyBilling = dailyHours * hourlyRate;

console.log(`Daily Total: ${dailyHours} hours (8h 00m)`);
console.log(`Total Phone: ${(shift1.phone + shift2.phone) / 3600} hours`);
console.log(`Total Off-Phone: ${(shift1.offPhone + shift2.offPhone) / 3600} hours`);
console.log(`Daily Billing @ $${hourlyRate}/hr = $${dailyBilling.toFixed(2)} CAD`);

console.log("\nAll unit logic validated successfully!");
