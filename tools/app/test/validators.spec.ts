import { describe, it, expect } from '@jest/globals';
import {
  isValidEmail,
  validateEmail,
  sanitizeEmail,
  validateRequired,
  isValidUuid,
  validateUuid,
  isValidUrl,
  validateUrl,
  normalizeUrl,
} from '../src/lib/validators.js';

describe('validators', () => {
  describe('isValidEmail', () => {
    it('should return true for valid email addresses', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
      expect(isValidEmail('test.user@example.co.uk')).toBe(true);
      expect(isValidEmail('user+tag@example.com')).toBe(true);
    });

    it('should return false for invalid email addresses', () => {
      expect(isValidEmail('not-an-email')).toBe(false);
      expect(isValidEmail('missing@domain')).toBe(false);
      expect(isValidEmail('@example.com')).toBe(false);
      expect(isValidEmail('user@')).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });
  });

  describe('validateEmail', () => {
    it('should return true for valid email', () => {
      expect(validateEmail('user@example.com')).toBe(true);
    });

    it('should return error message for empty email', () => {
      expect(validateEmail('')).toBe('Email address is required');
      expect(validateEmail('   ')).toBe('Email address is required');
    });

    it('should return error message for invalid email', () => {
      expect(validateEmail('not-an-email')).toBe(
        'Please enter a valid email address'
      );
    });
  });

  describe('sanitizeEmail', () => {
    it('should trim and lowercase email', () => {
      expect(sanitizeEmail('  User@Example.COM  ')).toBe('user@example.com');
    });

    it('should handle already clean email', () => {
      expect(sanitizeEmail('user@example.com')).toBe('user@example.com');
    });

    it('should trim whitespace only', () => {
      expect(sanitizeEmail('  test@test.com  ')).toBe('test@test.com');
    });
  });

  describe('validateRequired', () => {
    it('should return true for non-empty input', () => {
      const validator = validateRequired('Username');
      expect(validator('somevalue')).toBe(true);
    });

    it('should return error message for empty input', () => {
      const validator = validateRequired('Username');
      expect(validator('')).toBe('Username is required');
      expect(validator('   ')).toBe('Username is required');
    });

    it('should use custom field name in error message', () => {
      const validator = validateRequired('Display Name');
      expect(validator('')).toBe('Display Name is required');
    });
  });

  describe('isValidUuid', () => {
    it('should return true for valid UUIDs', () => {
      expect(isValidUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
      expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('should return false for invalid UUIDs', () => {
      expect(isValidUuid('not-a-uuid')).toBe(false);
      expect(isValidUuid('123e4567-e89b-12d3-a456')).toBe(false);
      expect(isValidUuid('')).toBe(false);
      expect(isValidUuid('123')).toBe(false);
    });
  });

  describe('validateUuid', () => {
    it('should return true for valid UUID', () => {
      expect(validateUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    });

    it('should return error message for empty input', () => {
      expect(validateUuid('')).toBe('ID is required');
      expect(validateUuid('   ')).toBe('ID is required');
    });

    it('should return error message for invalid UUID', () => {
      expect(validateUuid('not-a-uuid')).toBe('Please enter a valid UUID');
    });
  });

  describe('isValidUrl', () => {
    it('should return true for valid HTTP URLs', () => {
      expect(isValidUrl('http://example.com')).toBe(true);
      expect(isValidUrl('https://example.com')).toBe(true);
    });

    it('should return true for localhost URLs', () => {
      expect(isValidUrl('http://localhost:3000')).toBe(true);
      expect(isValidUrl('https://localhost')).toBe(true);
      expect(isValidUrl('http://127.0.0.1:8080')).toBe(true);
    });

    it('should return true for URLs with paths and query params', () => {
      expect(isValidUrl('https://example.com/path')).toBe(true);
      expect(isValidUrl('https://example.com/path?query=value')).toBe(true);
    });

    it('should return false for URLs without protocol', () => {
      expect(isValidUrl('example.com')).toBe(false);
      expect(isValidUrl('www.example.com')).toBe(false);
    });

    it('should return false for invalid protocols', () => {
      expect(isValidUrl('ftp://example.com')).toBe(false);
      expect(isValidUrl('file:///path/to/file')).toBe(false);
    });

    it('should return false for empty or invalid strings', () => {
      expect(isValidUrl('')).toBe(false);
      expect(isValidUrl('not a url')).toBe(false);
    });
  });

  describe('validateUrl', () => {
    it('should return true for valid URL', () => {
      expect(validateUrl('https://example.com')).toBe(true);
    });

    it('should return error message for empty input', () => {
      expect(validateUrl('')).toBe('URL is required');
      expect(validateUrl('   ')).toBe('URL is required');
    });

    it('should return error message for invalid URL', () => {
      expect(validateUrl('not-a-url')).toBe(
        'Please enter a valid URL (http:// or https://)'
      );
      expect(validateUrl('example.com')).toBe(
        'Please enter a valid URL (http:// or https://)'
      );
    });
  });

  describe('normalizeUrl', () => {
    it('should remove single trailing slash', () => {
      expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
    });

    it('should remove multiple trailing slashes', () => {
      expect(normalizeUrl('https://example.com///')).toBe(
        'https://example.com'
      );
    });

    it('should preserve URLs without trailing slashes', () => {
      expect(normalizeUrl('https://example.com')).toBe('https://example.com');
    });

    it('should trim whitespace', () => {
      expect(normalizeUrl('  https://example.com/  ')).toBe(
        'https://example.com'
      );
    });

    it('should preserve paths without trailing slashes', () => {
      expect(normalizeUrl('https://example.com/path')).toBe(
        'https://example.com/path'
      );
    });

    it('should remove trailing slashes from paths', () => {
      expect(normalizeUrl('https://example.com/path/')).toBe(
        'https://example.com/path'
      );
    });
  });
});
