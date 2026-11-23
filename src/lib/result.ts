export function jsonResult(data: unknown, summary?: string) {
  const json = JSON.stringify(data, null, 2);
  return {
    content: [
      {
        type: "text" as const,
        text: summary ? `${summary}\n\n${json}` : json,
      },
    ],
    structuredContent: data as Record<string, unknown>,
  };
}
