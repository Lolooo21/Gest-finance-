process.env.JWT_SECRET ??= "test-secret-test-secret-test-secret-123456";
process.env.DATABASE_OWNER_URL ??= "postgresql://gest:gest_dev@localhost:5432/gest_finance";
process.env.DATABASE_URL ??= "postgresql://gest_app:gest_app_dev_password@localhost:5432/gest_finance";
process.env.DATABASE_SYSTEM_URL ??= "postgresql://gest_system:gest_system_dev_password@localhost:5432/gest_finance";
export {};
process.env.FIELD_ENCRYPTION_KEY ??= "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
// Tests hermétiques : les clés VAPID de votre environnement ne doivent pas activer les notifications push dans les tests.
process.env.VAPID_PUBLIC_KEY = ""; // vide et non supprimé : Prisma recharge .env pour les variables absentes seulement
process.env.VAPID_PRIVATE_KEY = "";
process.env.VAPID_SUBJECT = "";
