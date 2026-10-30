import { getRuntimeConfig } from "../lib/runtime-config";

const config = getRuntimeConfig();
console.log("Runtime config databaseUrl:", config.databaseUrl.replace(/:[^:@]+@/, ":***@"));
console.log("Runtime config dbSslMode:", config.dbSslMode);

