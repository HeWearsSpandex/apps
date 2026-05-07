// ============================================================
// DepotIQ — Central Configuration
// Update SUPABASE_URL and SUPABASE_ANON_KEY with your project values
// ============================================================

const DEPOTIQ_CONFIG = {
  SUPABASE_URL:      'YOUR_SUPABASE_URL',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',
  APP_NAME:          'DepotIQ',
  VERSION:           '1.0.0',

  // Storage
  DELIVERY_NOTES_BUCKET: 'depotiq-delivery-notes',
  MAX_UPLOAD_SIZE_MB:    10,
  ALLOWED_MIME_TYPES:    ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],

  // Stock alerts
  SIGNED_URL_EXPIRY_SECONDS: 3600, // 1 hour

  // TV display refresh interval
  TV_REFRESH_MS: 60000, // 60 seconds
};
