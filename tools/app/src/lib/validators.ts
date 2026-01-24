import validator from 'validator';

/**
 * Validate an email address
 */
export function isValidEmail(email: string): boolean {
  return validator.isEmail(email);
}

/**
 * Validate email for Inquirer prompt
 */
export function validateEmail(input: string): boolean | string {
  if (!input.trim()) {
    return 'Email address is required';
  }

  if (!isValidEmail(input)) {
    return 'Please enter a valid email address';
  }

  return true;
}

/**
 * Sanitize email (lowercase and trim)
 */
export function sanitizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Validate a non-empty string
 */
export function validateRequired(fieldName: string) {
  return (input: string): boolean | string => {
    if (!input.trim()) {
      return `${fieldName} is required`;
    }
    return true;
  };
}

/**
 * Validate UUID format
 */
export function isValidUuid(input: string): boolean {
  return validator.isUUID(input);
}

/**
 * Validate UUID for Inquirer prompt
 */
export function validateUuid(input: string): boolean | string {
  if (!input.trim()) {
    return 'ID is required';
  }

  if (!isValidUuid(input)) {
    return 'Please enter a valid UUID';
  }

  return true;
}

/**
 * Validate a URL
 */
export function isValidUrl(url: string): boolean {
  return validator.isURL(url, {
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false, // Allow localhost
  });
}

/**
 * Validate URL for Inquirer prompt
 */
export function validateUrl(input: string): boolean | string {
  if (!input.trim()) {
    return 'URL is required';
  }

  if (!isValidUrl(input)) {
    return 'Please enter a valid URL (http:// or https://)';
  }

  return true;
}

/**
 * Normalize API URL (remove trailing slashes)
 */
export function normalizeApiUrl(url: string): string {
  let normalized = url.trim();
  while (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
