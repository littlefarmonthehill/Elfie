// Reference: blueprint:javascript_log_in_with_replit
export function isUnauthorizedError(error: Error): boolean {
  return /^401: .*Unauthorized/.test(error.message);
}

export function isNotApprovedError(error: Error): boolean {
  return /^403: .*Access not approved/.test(error.message);
}
