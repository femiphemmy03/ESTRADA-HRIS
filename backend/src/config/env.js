import dotenv from 'dotenv';
dotenv.config();

function required(name, fallback = undefined) {
  const value = process.env[name] ?? fallback;
  return value;
}

export const env = {
  port: required('PORT', 4000),
  nodeEnv: required('NODE_ENV', 'development'),
  frontendUrl: required('FRONTEND_URL', 'http://localhost:5173'),

  databaseUrl: required('DATABASE_URL'),

  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  jwtAccessExpiresIn: required('JWT_ACCESS_EXPIRES_IN', '15m'),
  jwtRefreshExpiresIn: required('JWT_REFRESH_EXPIRES_IN', '7d'),

  resendApiKey: required('RESEND_API_KEY'),
  resendFromEmail: required('RESEND_FROM_EMAIL', 'ESTRADA HRIS <onboarding@estradaintl.com>'),

  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  supabaseStorageBucket: required('SUPABASE_STORAGE_BUCKET', 'estrada-hris-documents'),
  defaultGpsRadiusMeters: Number(required('DEFAULT_GPS_RADIUS_METERS', 150)),

  // Where clients/admins pay money in to fund a client wallet. Shown read-only in the app.
  // (Replaced by per-client Flutterwave virtual accounts in the payments batch.)
  fundingBankName: required('FUNDING_BANK_NAME', ''),
  fundingAccountName: required('FUNDING_ACCOUNT_NAME', ''),
  fundingAccountNumber: required('FUNDING_ACCOUNT_NUMBER', ''),
  fundingNote: required('FUNDING_NOTE', 'Use the reference shown after you submit as your transfer narration.'),
};
