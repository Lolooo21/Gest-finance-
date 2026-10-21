import { assertProductionConfig } from "./config.js";
import { loadSecretsFromFiles } from "./secrets.js";

// Doit être le premier import de main.ts : les secrets doivent être en place avant la création de l'application.
loadSecretsFromFiles();
assertProductionConfig();
