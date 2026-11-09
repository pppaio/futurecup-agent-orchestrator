import { NODES, NODE_STATE_TEXT, type NodeState } from '../bits';

interface Props {
  states: Record<string, NodeState>;
}

export function NodeBar({ states }: Props) {
  return (
    <div className="node-bar">
      {NODES.map((node, i) => {
        const state: NodeState = states[node.id] ?? 'idle';
        return (
          <div key={node.id} className="node-row">
            <div className={`node-chip node-${state}`}>
              <span className="node-id">{node.id}</span>
              <span className="node-label">{node.label}</span>
              <span className="node-state">{NODE_STATE_TEXT[state]}</span>
            </div>
            {i < NODES.length - 1 && <div className="node-connector" />}
          </div>
        );
      })}
    </div>
  );
}
