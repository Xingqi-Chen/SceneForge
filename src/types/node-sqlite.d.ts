declare module "node:sqlite" {
  export type SqlitePrimitive = string | number | bigint | null | Uint8Array;

  export class StatementSync {
    all(...values: SqlitePrimitive[]): unknown[];
    get(...values: SqlitePrimitive[]): unknown;
    run(...values: SqlitePrimitive[]): unknown;
  }

  export class DatabaseSync {
    constructor(location: string);
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
