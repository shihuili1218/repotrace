export type RequestStage =
  | 'ROUTING'
  | 'INIT_DB'
  | 'AUTH_ADMIN'
  | 'AUTH_SESSION'
  | 'AUTH_LOGIN'
  | 'API'
  | 'DASHBOARD'
  | 'MONITORING'
  | 'WEBHOOK'
  | 'ASSETS';

// Inspect messages locally, but only publish fixed categories. D1 messages can
// include SQL, bound values, and upstream responses that must remain private.
export function failureReason(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  for (let cause = error; cause instanceof Error && !seen.has(cause); cause = cause.cause) {
    seen.add(cause);
    messages.push(cause.message);
    if (seen.size === 5) break;
  }
  const message = messages.join('\n');
  if (/cannot perform I\/O on behalf of a different|different request.?s handler/i.test(message))
    return 'CROSS_REQUEST_IO';
  if (/no such (?:table|column)|D1_COLUMN_NOTFOUND|has no column named/i.test(message))
    return 'D1_SCHEMA';
  if (
    /subquer(?:y|ies).*(?:deep|depth)|(?:deep|depth).*subquer|parser stack overflow|expression tree is too large/i.test(
      message,
    )
  )
    return 'D1_QUERY_DEPTH';
  if (
    /exceeded.*limit|too many (?:SQL variables|API requests|subrequests)|maximum.*(?:size|storage)|daily row (?:read|write) limit/i.test(
      message,
    )
  )
    return 'D1_LIMIT';
  if (
    /D1.*(?:overloaded|reset|timeout|transient)|network connection lost|replica disconnected/i.test(
      message,
    )
  )
    return 'D1_UNAVAILABLE';
  if (/D1_TYPE_ERROR/i.test(message)) return 'D1_TYPE';
  if (/D1_ERROR|D1_EXEC_ERROR|SQLITE_/i.test(message)) return 'D1_OTHER';
  return 'INTERNAL';
}

export function failureCode(stage: RequestStage, error: unknown): string {
  return `${stage}/${failureReason(error)}`;
}
