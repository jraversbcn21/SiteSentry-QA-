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

  function renderStepFields(step: FlowStep, index: number) {
    const fields: JSX.Element[] = [];
    if (step.action === 'navigate') {
      fields.push(<input key="url" className="fe-step-input" placeholder="URL" value={step.url || ''} onChange={function(e) { handleStepChange(index, 'url', e.target.value); }} />);
    } else if (step.action === 'click' || step.action === 'hover') {
      fields.push(<input key="selector" className="fe-step-input" placeholder="Selector CSS" value={step.selector || ''} onChange={function(e) { handleStepChange(index, 'selector', e.target.value); }} />);
    } else if (step.action === 'type') {
      fields.push(<input key="selector" className="fe-step-input" placeholder="Selector CSS" value={step.selector || ''} onChange={function(e) { handleStepChange(index, 'selector', e.target.value); }} />);
      fields.push(<input key="value" className="fe-step-input" placeholder="Valor" value={step.value || ''} onChange={function(e) { handleStepChange(index, 'value', e.target.value); }} />);
    } else if (step.action === 'wait') {
      fields.push(<input key="ms" className="fe-step-input" type="number" placeholder="Milisegundos" value={step.ms || ''} onChange={function(e) { handleStepChange(index, 'ms', parseInt(e.target.value, 10) || undefined); }} />);
    } else if (step.action === 'select') {
      fields.push(<input key="selector" className="fe-step-input" placeholder="Selector CSS" value={step.selector || ''} onChange={function(e) { handleStepChange(index, 'selector', e.target.value); }} />);
      fields.push(<input key="value" className="fe-step-input" placeholder="Valor" value={step.value || ''} onChange={function(e) { handleStepChange(index, 'value', e.target.value); }} />);
    } else if (step.action === 'press') {
      fields.push(<input key="selector" className="fe-step-input" placeholder="Selector CSS (opcional)" value={step.selector || ''} onChange={function(e) { handleStepChange(index, 'selector', e.target.value); }} />);
      fields.push(<input key="key" className="fe-step-input" placeholder="Tecla (Enter, Tab...)" value={step.key || ''} onChange={function(e) { handleStepChange(index, 'key', e.target.value); }} />);
    }
    return fields;
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
