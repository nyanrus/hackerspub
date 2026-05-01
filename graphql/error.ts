import { builder } from "./builder.ts";

export class InvalidInputError extends Error {
  public constructor(public readonly inputPath: string) {
    super(`Invalid input - ${inputPath}`);
  }
}

builder.objectType(InvalidInputError, {
  name: "InvalidInputError",
  fields: (t) => ({
    inputPath: t.expose("inputPath", { type: "String" }),
  }),
});

export class NotAuthorizedError extends Error {
  public constructor() {
    super("Not authorized");
  }
}

builder.objectType(NotAuthorizedError, {
  name: "NotAuthorizedError",
  fields: (t) => ({
    notAuthorized: t.string({
      resolve: () => "",
    }),
  }),
});
