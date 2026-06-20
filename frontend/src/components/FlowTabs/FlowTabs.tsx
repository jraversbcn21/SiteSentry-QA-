import type { StepResult } from '../../types';
import './FlowTabs.css';

interface FlowTabsProps {
  steps: StepResult[];
  activeStepIndex: number;
  allIssuesCount: number;
  onStepChange: (index: number) => void;
}

var STEP_ICONS: Record<string, string> = {
  navigate: '🌐',
  click: '🖱️',
  type: '⌨️',
  wait: '⏱️',
  select: '📋',
  hover: '👆',
  press: '⌨️',
  checkpoint: '📸',
};

export default function FlowTabs({ steps, activeStepIndex, allIssuesCount, onStepChange }: FlowTabsProps) {
  var icon = function(action: string) { return STEP_ICONS[action] || '▶️'; };

  return (
    <div className="flow-tabs">
      {steps.map(function(step) {
        var isActive = activeStepIndex === step.index;
        var label = icon(step.action) + ' ' + step.label;
        return (
          <button key={step.index} className={'flow-tab' + (isActive ? ' active' : '')} onClick={function() { onStepChange(step.index); }}>
            <span>{label}</span>
            <span className="flow-tab-badge">{step.summary.total}</span>
          </button>
        );
      })}
      <button className={'flow-tab' + (activeStepIndex === -1 ? ' active' : '')} onClick={function() { onStepChange(-1); }}>
        <span>📊 Resumen</span>
        <span className="flow-tab-badge">{allIssuesCount}</span>
      </button>
    </div>
  );
}
