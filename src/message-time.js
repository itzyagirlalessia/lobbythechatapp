// Date labels follow the calendar in the reader's local time zone.
const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const calendarDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });
const nearbyDays = new Map([[-1, 'Yesterday'], [0, 'Today'], [1, 'Tomorrow']]);
let midnightTimer;

function calendarDay(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

export function messageTimeLabel(date, now = new Date()) {
  const day = nearbyDays.get(calendarDay(date) - calendarDay(now)) ?? calendarDate.format(date);
  return clock.format(date) + ' · ' + day;
}

export function messageTime(timestamp, className = '') {
  const date = new Date(timestamp);
  const stamp = document.createElement('time');
  stamp.className = className;
  stamp.dateTime = date.toISOString();
  stamp.title = fullDate.format(date);
  stamp.textContent = messageTimeLabel(date);
  stamp.dataset.messageTime = '';
  return stamp;
}

export function syncMessageDates() {
  clearTimeout(midnightTimer);
  const now = new Date();
  for (const stamp of document.querySelectorAll('time[data-message-time]')) {
    stamp.textContent = messageTimeLabel(new Date(stamp.dateTime), now);
  }
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  midnightTimer = setTimeout(syncMessageDates, midnight - now);
}
