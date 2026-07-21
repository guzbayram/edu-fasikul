# EduFasikül

Lise öğrencileri için tablet+kalem destekli, gerçek zamanlı senkronizasyonlu PDF çalışma uygulaması.

**Canlı Site:** https://guzbayram.github.io/edu-fasikul/

---

## Kurulum

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ klasörüne üret
```

---

## Mimari

```
src/
├── main.js                 # Uygulama giriş noktası, init
├── state/
│   └── appState.js         # Tek kaynak reaktif store
├── firebase/
│   ├── init.js             # Firebase başlatma (Auth + Firestore)
│   ├── auth.js             # Giriş, çıkış, kayıt, admin işlemleri
│   └── firestore.js        # CRUD yardımcıları, istatistik, migration
├── sync/
│   └── realtime.js         # onSnapshot dinleyicileri (cevap + çizim + hatalılar)
├── pdf/
│   ├── render.js           # PDF.js render pipeline
│   └── storage.js          # IndexedDB PDF cache, hash doğrulama, 50 MB limit
├── drawing/
│   ├── canvas.js           # Fabric.js başlatma/dispose
│   └── tools.js            # Kalem/marker/silgi/text/seçim araçları, undo/redo
├── reader/
│   ├── index.js            # Reader overlay aç/kapat
│   ├── toolbar.js          # Üst toolbar event'leri, zoom
│   └── panel.js            # Soru kartı render, cevap seçimi, hatalılar
├── panels/
│   ├── dashboard.js        # Fasikül grid, progress hesaplama
│   ├── stats.js            # İstatistik paneli, haftalık chart
│   ├── hatalilar.js        # Hatalılar listesi, tekrar modu
│   ├── profil.js           # Avatar, tema, tercihler
│   └── admin.js            # Kullanıcı yönetimi (admin)
├── ui/
│   ├── toast.js            # showToast bildirimleri
│   ├── router.js           # showPanel, sidebar toggle
│   └── onboarding.js       # İlk kullanım turu
└── styles/
    ├── base.css
    ├── reader.css
    └── panels.css
```

**Teknolojiler:** Firebase 10 (Firestore + Auth) · PDF.js 3.11 · Fabric.js 5.3 · Chart.js 4.4 · Vite 5

---

## Veri Modeli (Firestore)

```
kullanicilar/{uid}
  ├── istatistik            # Toplam/doğru/yanlış sayıları
  ├── preferences           # Kullanıcı tercihleri
  ├── cozumler/{soruKey}    # Çözülen her soru (real-time sync)
  ├── cizimler/{key}        # Sayfa başına çizim JSON (Fabric.js)
  └── hatalilar/{soruKey}   # Hatalı sorular subcollection

fasikuller/{fasikulId}
  └── hash, pageCount       # PDF bütünlük doğrulaması
```

**PDF Gizliliği:** PDF dosyaları hiçbir zaman sunucuya yüklenmez. Sadece SHA-256 hash ve sayfa sayısı Firestore'a yazılır.

---

## Yeni Modül Ekleme

1. `src/panels/yeniPanel.js` oluştur
2. Alt kısma `window.yeniFonk = yeniFonk;` ekle
3. `src/main.js` başına `import './panels/yeniPanel.js';` ekle
4. `index.html` içine `<div id="panel-yeni" class="panel">` ekle
5. `src/ui/router.js` içindeki `titles` objesine panel adını ekle

Modüller arası iletişim `window.xxx?.()` pattern'i ile yapılır — doğrudan import döngüsel bağımlılık yaratabilir.

---

## Deploy

`vite-migration` branch'e push → GitHub Actions otomatik build → `gh-pages` branch → canlı site.

```yaml
# .github/workflows/deploy.yml
on:
  push:
    branches: [vite-migration]
```
