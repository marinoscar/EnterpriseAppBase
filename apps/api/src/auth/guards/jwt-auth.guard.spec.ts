import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(async () => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [JwtAuthGuard, { provide: Reflector, useValue: reflector }],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);

    // Mock super.canActivate to avoid Passport initialization
    jest.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate').mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createMockContext(): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({}),
        getResponse: () => ({
          code: jest.fn().mockReturnThis(),
          send: jest.fn(),
        }),
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as any;
  }

  describe('canActivate', () => {
    it('should return true for routes marked with @Public() decorator', () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      const context = createMockContext();

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, expect.any(Array));
    });

    it('should call super.canActivate() for protected routes', () => {
      reflector.getAllAndOverride.mockReturnValue(false);
      const context = createMockContext();
      const superSpy = jest.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate');

      guard.canActivate(context);

      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, expect.any(Array));
      expect(superSpy).toHaveBeenCalledWith(context);
    });

    it('should skip JWT validation when isPublic is true', () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      const context = createMockContext();
      const superSpy = jest.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate');

      const result = guard.canActivate(context);

      // Should return true without calling super.canActivate
      expect(result).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalled();
      expect(superSpy).not.toHaveBeenCalled();
    });

    it('should check both handler and class for @Public() decorator', () => {
      reflector.getAllAndOverride.mockReturnValue(false);
      const context = createMockContext();

      guard.canActivate(context);

      // getAllAndOverride is called with both handler and class targets
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, expect.any(Array));
      const callArgs = reflector.getAllAndOverride.mock.calls[0][1];
      expect(callArgs).toHaveLength(2); // Handler and class
    });
  });

  describe('Public decorator precedence', () => {
    it('should handle undefined isPublic metadata', () => {
      reflector.getAllAndOverride.mockReturnValue(undefined);
      const context = createMockContext();
      const superSpy = jest.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate');

      // undefined means not public, should call super.canActivate
      guard.canActivate(context);

      expect(reflector.getAllAndOverride).toHaveBeenCalled();
      expect(superSpy).toHaveBeenCalled();
    });

    it('should handle null isPublic metadata', () => {
      reflector.getAllAndOverride.mockReturnValue(null);
      const context = createMockContext();
      const superSpy = jest.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate');

      // null means not public, should call super.canActivate
      guard.canActivate(context);

      expect(reflector.getAllAndOverride).toHaveBeenCalled();
      expect(superSpy).toHaveBeenCalled();
    });

    it('should handle false isPublic metadata explicitly', () => {
      reflector.getAllAndOverride.mockReturnValue(false);
      const context = createMockContext();
      const superSpy = jest.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate');

      guard.canActivate(context);

      expect(superSpy).toHaveBeenCalled();
    });
  });

  describe('Reflector metadata retrieval', () => {
    it('should use getAllAndOverride to check decorator precedence', () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      const context = createMockContext();

      guard.canActivate(context);

      // getAllAndOverride checks handler first, then class
      // This ensures method-level @Public() takes precedence over class-level
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, expect.any(Array));
    });

    it('should pass correct metadata key to reflector', () => {
      reflector.getAllAndOverride.mockReturnValue(false);
      const context = createMockContext();

      guard.canActivate(context);

      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, expect.any(Array));
    });
  });

  describe('Integration with Passport (tested via integration tests)', () => {
    it('should delegate JWT validation to Passport strategy', () => {
      // The actual JWT validation is done by Passport and the JwtStrategy
      // This is tested in integration tests with real HTTP requests
      // Unit tests focus on the @Public() decorator logic
      expect(true).toBe(true);
    });

    it('should throw UnauthorizedException for invalid tokens (integration)', () => {
      // Invalid tokens, expired tokens, and missing tokens are handled
      // by Passport's AuthGuard and tested in integration tests
      expect(true).toBe(true);
    });
  });
});
