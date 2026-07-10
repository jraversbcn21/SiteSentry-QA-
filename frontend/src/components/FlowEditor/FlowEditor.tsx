import { useState } from 'react';
import type { FlowStep, FlowDefinition } from '../../types';
import { parseCodegenScript } from '../../services/codegenConverter';
import { scanApi } from '../../services/api';
import './FlowEditor.css';

interface FlowEditorProps {
  editFlow?: FlowDefinition;
  onSave: (flow: { name: string; steps: FlowStep[] }) => void;
  onCancel: () => void;
}

const ACTION_OPTIONS = [
  { value: 'navigate', label: '🌐 Navegar' },
  { value: 'click', label: '🖱️ Click' },
  { value: 'type', label: '⌨️ Escribir' },
  { value: 'wait', label: '⏱️ Esperar' },
  { value: 'select', label: '📋 Seleccionar' },
  { value: 'hover', label: '👆 Hover' },
  { value: 'press', label: '⌨️ Tecla' },
  { value: 'checkpoint', label: '📸 Checkpoint' },
];

export default function FlowEditor({ editFlow, onSave, onCancel }: FlowEditorProps) {
  const [name, setName] = useState(editFlow?.name || '');
  const [steps, setSteps] = useState<FlowStep[]>(editFlow?.steps || []);
  const [codegenScript, setCodegenScript] = useState('');
  const [saving, setSaving] = useState(false);

  function handleConvert() {
    const parsed = parseCodegenScript(codegenScript);
    if (parsed.length > 0) setSteps(parsed);
  }

  function handleStepChange(index: number, field: string, value: string | number | undefined) {
    const newSteps = steps.map(function(s, i) {
      if (i === index) return { ...s, [field]: value };
      return s;
    });
    setSteps(newSteps);
  }

  function handleDeleteStep(index: number) {
    setSteps(steps.filter(function(_, i) { return i !== index; }));
  }

  function handleAddStep() {
    setSteps([...steps, { action: 'click' }]);
  }

  async function handleSave() {
    if (!name.trim() || steps.length === 0) return;
    const flow = { name: name.trim(), steps };
    if (editFlow?.id) {
      setSaving(true);
      try {
        await scanApi.updateFlow(editFlow.id, flow.name, flow.steps);
      } finally { setSaving(false); }
    }
    onSave(flow);
  }

  function StepField({ placeholder, field, type, stepIndex, value }: { placeholder: string; field: string; type?: string; stepIndex: number; value: string | number | undefined }) {
    return (
      <input
        className="fe-step-input"
        placeholder={placeholder}
        type={type || 'text'}
        value={value || ''}
        onChange={function(e) { handleStepChange(stepIndex, field, type === 'number' ? (parseInt(e.target.value, 10) || undefined) : e.target.value); }}
      />
    );
  }

  function renderStepFields(step: FlowStep, index: number) {
    if (step.action === 'navigate') {
      return <StepField field="url" placeholder="URL" stepIndex={index} value={step.url} />;
    } else if (step.action === 'click' || step.action === 'hover') {
      return <StepField field="selector" placeholder="Selector CSS" stepIndex={index} value={step.selector} />;
    } else if (step.action === 'type') {
      return (
        <>
          <StepField field="selector" placeholder="Selector CSS" stepIndex={index} value={step.selector} />
          <StepField field="value" placeholder="Valor" stepIndex={index} value={step.value} />
        </>
      );
    } else if (step.action === 'wait') {
      return <StepField field="ms" placeholder="Milisegundos" type="number" stepIndex={index} value={step.ms} />;
    } else if (step.action === 'select') {
      return (
        <>
          <StepField field="selector" placeholder="Selector CSS" stepIndex={index} value={step.selector} />
          <StepField field="value" placeholder="Valor" stepIndex={index} value={step.value} />
        </>
      );
    } else if (step.action === 'press') {
      return (
        <>
          <StepField field="selector" placeholder="Selector CSS (opcional)" stepIndex={index} value={step.selector} />
          <StepField field="key" placeholder="Tecla (Enter, Tab...)" stepIndex={index} value={step.key} />
        </>
      );
    }
    return null;
  }

  return (
    <div className="flow-editor">
      <h3>{editFlow ? 'Editar Flujo' : 'Nuevo Flujo'}</h3>
      <input className="fe-name-input" placeholder="Nombre del flujo" value={name} onChange={function(e) { setName(e.target.value); }} />

      <div className="fe-codegen-section">
        <label>Pegar script de Playwright Codegen</label>
        <textarea className="fe-codegen-textarea" value={codegenScript} onChange={function(e) { setCodegenScript(e.target.value); }} placeholder={`await page.goto('https://...');\nawait page.click('#login');\nawait page.fill('#user', 'admin');`} />
        <button className="fe-convert-btn" onClick={handleConvert}>Convertir a pasos</button>
      </div>

      <ul className="fe-steps-list">
        {steps.map(function(step, index) {
          return (
            <li key={index} className="fe-step-item">
              <span className="fe-step-index">#{index + 1}</span>
              <select className="fe-step-action-select" value={step.action} onChange={function(e) { handleStepChange(index, 'action', e.target.value); }}>
                {ACTION_OPTIONS.map(function(opt) { return <option key={opt.value} value={opt.value}>{opt.label}</option>; })}
              </select>
              {renderStepFields(step, index)}
              <button className="fe-step-delete" onClick={function() { handleDeleteStep(index); }}>🗑️</button>
            </li>
          );
        })}
      </ul>

      <button className="fe-add-step" onClick={handleAddStep}>+ Agregar paso</button>

      <div className="fe-actions">
        <button className="fe-cancel-btn" onClick={onCancel}>Cancelar</button>
        <button className="fe-save-btn" onClick={handleSave} disabled={saving || !name.trim() || steps.length === 0}>
          {saving ? 'Guardando...' : (editFlow ? 'Actualizar flujo' : 'Guardar flujo')}
        </button>
      </div>
    </div>
  );
}
