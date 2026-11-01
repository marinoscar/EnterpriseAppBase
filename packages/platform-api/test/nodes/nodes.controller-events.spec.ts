import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { NodesAdminController } from '../../src/nodes/nodes-admin.controller';
import { NodesController } from '../../src/nodes/nodes.controller';
import { NODE_SERVER_FEATURES } from '../../src/nodes/dto/node-response.dto';

// =============================================================================
// GET /nodes/:id/events and its admin twin (issue #1045): access parity with the
// node detail route, and the serverFeatures advertisement
// =============================================================================

const NODE_ID = '00000000-0000-4000-8000-000000000001';
const QUERY = { page: 1, pageSize: 20 } as any;

function controller() {
  const nodes = {
    getNode: jest.fn(),
    heartbeat: jest.fn(),
    register: jest.fn(),
  };
  const events = { list: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 }) };
  const c = new NodesController(nodes as any, {} as any, {} as any, {} as any, events as any);
  return { c, nodes, events };
}

describe('NodesController.listEvents', () => {
  it('lists the events of a node the caller owns', async () => {
    const { c, nodes, events } = controller();
    nodes.getNode.mockResolvedValue({ id: NODE_ID });

    await c.listEvents(NODE_ID, QUERY, 'user-1');

    expect(nodes.getNode).toHaveBeenCalledWith('user-1', NODE_ID);
    expect(events.list).toHaveBeenCalledWith(NODE_ID, QUERY);
  });

  it('answers exactly like GET /nodes/:id: 404 for no such node, 403 for somebody else\'s, and reads no events', async () => {
    const { c, nodes, events } = controller();

    nodes.getNode.mockRejectedValue(new NotFoundException());
    await expect(c.listEvents(NODE_ID, QUERY, 'user-1')).rejects.toBeInstanceOf(NotFoundException);

    nodes.getNode.mockRejectedValue(new ForbiddenException());
    await expect(c.listEvents(NODE_ID, QUERY, 'user-2')).rejects.toBeInstanceOf(ForbiddenException);

    expect(events.list).not.toHaveBeenCalled();
  });
});

describe('NodesAdminController.listEvents', () => {
  it('reads any node (the admin scope is the deployment); a missing node is the service\'s 404', async () => {
    const events = { list: jest.fn().mockResolvedValue({ items: [] }) };
    const admin = new NodesAdminController({} as any, events as any);

    await admin.listEvents(NODE_ID, QUERY);
    expect(events.list).toHaveBeenCalledWith(NODE_ID, QUERY);

    events.list.mockRejectedValue(new NotFoundException());
    await expect(admin.listEvents(NODE_ID, QUERY)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('serverFeatures', () => {
  it('advertises node_host_vitals on register and beside the node fields on heartbeat', async () => {
    const { c, nodes } = controller();
    const row = {
      id: NODE_ID, name: 'n', hostname: 'h', platform: 'p', cliVersion: '1', eligibleTypes: [], concurrency: 1,
      status: 'online', capabilities: null, registeredAt: new Date(), lastHeartbeatAt: new Date(),
    };
    nodes.register.mockResolvedValue({ node: row, reattached: false });
    nodes.heartbeat.mockResolvedValue(row);

    const registered = await c.register({} as any, 'user-1');
    const beat = await c.heartbeat(NODE_ID, {} as any, 'user-1');

    expect(NODE_SERVER_FEATURES).toEqual(['node_host_vitals']);
    expect(registered.serverFeatures).toEqual(['node_host_vitals']);
    expect(beat.serverFeatures).toEqual(['node_host_vitals']);
    expect(beat.id).toBe(NODE_ID);
    expect(beat.name).toBe('n');
  });
});
