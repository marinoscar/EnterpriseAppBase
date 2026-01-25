import {
  describe,
  expect,
  it,
  jest,
  beforeEach,
  afterEach,
} from '@jest/globals';

// Mock modules before importing the module under test
const mockApiRequest = jest.fn<any>();
const mockApiUploadFile = jest.fn<any>();

jest.unstable_mockModule('../../src/lib/api-client.js', () => ({
  apiRequest: mockApiRequest,
  apiUploadFile: mockApiUploadFile,
}));

jest.unstable_mockModule('../../src/utils/output.js', () => ({
  header: jest.fn(),
  blank: jest.fn(),
  success: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  dim: jest.fn(),
  bold: jest.fn(),
  keyValue: jest.fn(),
  tableHeader: jest.fn(),
  tableRow: jest.fn(),
}));

describe('storage commands', () => {
  let listObjects: any;
  let getObject: any;
  let downloadObject: any;
  let deleteObject: any;
  let uploadFile: any;

  beforeEach(async () => {
    // Reset mocks before importing
    jest.clearAllMocks();

    // Import the module under test after mocks are set up
    const commands = await import('../../src/commands/storage.js');
    listObjects = commands.listObjects;
    getObject = commands.getObject;
    downloadObject = commands.downloadObject;
    deleteObject = commands.deleteObject;
    uploadFile = commands.uploadFile;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('listObjects', () => {
    it('should throw when API returns error', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Unauthorized' }),
      });

      await expect(listObjects({})).rejects.toThrow('Unauthorized');
    });

    it('should throw with default message when error message missing', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({}),
      });

      await expect(listObjects({})).rejects.toThrow(
        'Failed to list storage objects'
      );
    });

    it('should request storage objects endpoint', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            items: [],
            meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
          },
        }),
      });

      await listObjects({});

      expect(mockApiRequest).toHaveBeenCalledWith('/storage/objects');
    });

    it('should include pagination params', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            items: [],
            meta: { page: 2, pageSize: 10, totalItems: 0, totalPages: 0 },
          },
        }),
      });

      await listObjects({ page: 2, limit: 10 });

      expect(mockApiRequest).toHaveBeenCalledWith(
        '/storage/objects?page=2&pageSize=10'
      );
    });

    it('should include status filter', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            items: [],
            meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
          },
        }),
      });

      await listObjects({ status: 'ready' });

      expect(mockApiRequest).toHaveBeenCalledWith(
        '/storage/objects?status=ready'
      );
    });

    it('should output JSON when json option is true', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            items: [
              {
                id: 'obj-1',
                name: 'test.txt',
                size: '1024',
                mimeType: 'text/plain',
                status: 'ready',
                createdAt: '2024-01-01T00:00:00Z',
              },
            ],
            meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
          },
        }),
      });

      await listObjects({ json: true });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('getObject', () => {
    it('should throw when API returns error', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Object not found' }),
      });

      await expect(getObject('obj-123', {})).rejects.toThrow('Object not found');
    });

    it('should request specific object endpoint', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            id: 'obj-123',
            name: 'test.txt',
            size: '1024',
            mimeType: 'text/plain',
            status: 'ready',
            metadata: null,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        }),
      });

      await getObject('obj-123', {});

      expect(mockApiRequest).toHaveBeenCalledWith('/storage/objects/obj-123');
    });

    it('should output JSON when json option is true', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            id: 'obj-123',
            name: 'test.txt',
            size: '1024',
            mimeType: 'text/plain',
            status: 'ready',
            metadata: { key: 'value' },
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        }),
      });

      await getObject('obj-123', { json: true });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('downloadObject', () => {
    it('should throw when API returns error', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Object not ready for download' }),
      });

      await expect(downloadObject('obj-123', {})).rejects.toThrow(
        'Object not ready for download'
      );
    });

    it('should request download endpoint', async () => {
      const consoleSpy = jest
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            url: 'https://signed-url.example.com/download',
            expiresIn: 3600,
          },
        }),
      });

      await downloadObject('obj-123', {});

      expect(mockApiRequest).toHaveBeenCalledWith(
        '/storage/objects/obj-123/download'
      );
      consoleSpy.mockRestore();
    });
  });

  describe('deleteObject', () => {
    it('should throw when API returns error', async () => {
      mockApiRequest.mockResolvedValue({
        ok: false,
        json: async () => ({ message: 'Object not found' }),
      });

      await expect(deleteObject('obj-123', { force: true })).rejects.toThrow(
        'Object not found'
      );
    });

    it('should send DELETE request with force option', async () => {
      mockApiRequest.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      await deleteObject('obj-123', { force: true });

      expect(mockApiRequest).toHaveBeenCalledWith('/storage/objects/obj-123', {
        method: 'DELETE',
      });
    });
  });
});
