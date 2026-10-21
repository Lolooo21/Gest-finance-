process.env.JWT_SECRET ??= "test-secret-test-secret-test-secret-123456";
process.env.DATABASE_OWNER_URL ??= "postgresql://gest:gest_dev@localhost:5432/gest_finance";
process.env.DATABASE_URL ??= "postgresql://gest_app:gest_app_dev_password@localhost:5432/gest_finance";
process.env.DATABASE_SYSTEM_URL ??= "postgresql://gest_system:gest_system_dev_password@localhost:5432/gest_finance";
export {};
process.env.FIELD_ENCRYPTION_KEY ??= "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
// Tests hermétiques : les clés VAPID de votre environnement ne doivent pas activer les notifications push dans les tests.
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
delete process.env.VAPID_SUBJECT;
