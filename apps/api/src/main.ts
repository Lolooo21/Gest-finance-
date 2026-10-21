import "./bootstrap.js";
import "reflect-metadata";
import { createApp } from "./app.js";

const app = await createApp();
await app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
