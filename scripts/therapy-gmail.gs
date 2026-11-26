// Apps Script for connorvanscyoc.com/therapy.
// Lists Venmo payments to Sarah Baker since Nov 2026: payment date + caption only.
// Deploy: Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone.
// Put the web app URL in Cloudflare as the secret THERAPY_SCRIPT_URL.
function doGet() {
  const threads = GmailApp.search('from:venmo@venmo.com subject:"You paid Sarah Baker" after:2026/11/20', 0, 300);
  const payments = [];
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      if (!/^You paid Sarah Baker/.test(m.getSubject())) return;
      const found = m.getBody().match(/class="transaction-note[^"]*"[^>]*>([^<]*)</);
      payments.push({
        date: Utilities.formatDate(m.getDate(), 'America/New_York', 'yyyy-MM-dd'),
        note: found ? found[1].trim() : ''
      });
    });
  });
  return ContentService.createTextOutput(JSON.stringify({ payments: payments }))
    .setMimeType(ContentService.MimeType.JSON);
}
