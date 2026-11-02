/* ============================================================
   通知の受け取り役（サービスワーカー）  2026-11-01 新規
   ANSHIN KUN・しおどめポータルサイトの各リポジトリの一番上に、同じ中身で置く
     kimkat01/staff-dashboard/sw.js
     kimkat01/fureai-moriya-staff-dashboard/sw.js
     kimkat01/shiodome-knowledge/sw.js
   ・ページの保存（キャッシュ）はしない。通知とアイコンの数字だけを扱う
   ============================================================ */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  var n = Number(d.badge) || 0;
  var jobs = [
    self.registration.showNotification(d.title || 'お知らせ', {
      body: d.body || '新しいお知らせがあります',
      tag: d.tag || 'shiodome',
      renotify: true,
      icon: 'icons/icon-192.png',
      data: { url: d.url || '' }
    })
  ];
  if (self.navigator && self.navigator.setAppBadge) {
    jobs.push((n > 0 ? self.navigator.setAppBadge(n) : self.navigator.clearAppBadge()).catch(function () {}));
  }
  e.waitUntil(Promise.all(jobs));
});

/* 通知を押したら、開いている画面を前に出す（なければホーム画面のURLで開く） */
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].url.indexOf(self.registration.scope) === 0 && 'focus' in list[i]) return list[i].focus();
    }
    return self.clients.openWindow(url);
  }));
});
