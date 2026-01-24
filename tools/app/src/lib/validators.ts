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
