import { useState } from 'react';
import { Issue, IssueType, VisualDiff } from '../../types';
import ErrorCard from '../ErrorCard/ErrorCard';
import { typeConfig } from '../../config/issueTypeConfig';
import './ErrorGroup.css';

interface ErrorGroupProps {
  type: IssueType;
  issues: Issue[];
  defaultOpen?: boolean;
  visualDiffsMap?: Record<string, VisualDiff>;
}

export default function ErrorGroup({ type, issues, defaultOpen = false, visualDiffsMap }: ErrorGroupProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const config = typeConfig[type] || { label: type, icon: '⚠️', color: '#94a3b8' };

  const highCount = issues.filter((i) => i.severity === 'HIGH').length;
  const mediumCount = issues.filter((i) => i.severity === 'MEDIUM').length;
  const lowCount = issues.filter((i) => i.severity === 'LOW').length;

  return (
    <div className="error-group">
      <button
        className="error-group-header"
        onClick={() => setIsOpen(!isOpen)}
        style={{ borderLeftColor: config.color }}
      >
        <div className="error-group-title">
          <span className="error-group-icon">{config.icon}</span>
          <span className="error-group-label">{config.label}</span>
          <span className="error-group-count">{issues.length}</span>
        </div>
        <div className="error-group-summary">
          {highCount > 0 && <span className="summary-badge high">{highCount} Alto</span>}
          {mediumCount > 0 && <span className="summary-badge medium">{mediumCount} Medio</span>}
          {lowCount > 0 && <span className="summary-badge low">{lowCount} Bajo</span>}
          <span className="error-group-chevron">{isOpen ? '▲' : '▼'}</span>
        </div>
      </button>

      {isOpen && (
        <div className="error-group-content">
          {issues.map((issue, index) => (
            <ErrorCard key={`${issue.url}-${index}`} issue={issue} visualDiff={visualDiffsMap?.[issue.id || '']} />
          ))}
        </div>
      )}
    </div>
  );
}
