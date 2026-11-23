export class ToolError extends Error {
  hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = "ToolError";
    this.hint = hint;
  }
}

export function asErrorMessage(error: unknown): string {
  if (error instanceof ToolError) {
    return error.hint ? `${error.message}\nHint: ${error.hint}` : error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function toolFailure(message: string, hint?: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: hint ? `${message}\n\nHint: ${hint}` : message,
      },
    ],
    isError: true,
  };
}
