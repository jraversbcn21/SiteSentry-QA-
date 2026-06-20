import axios from 'axios';
import { ScanRequest, ScanResponse, ScanStatusResponse, ReportResponse, FlowDefinition, FlowStep } from '../types';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

export const scanApi = {
  startScan: async (request: ScanRequest): Promise<ScanResponse> => {
    const response = await api.post<ScanResponse>('/scan', request);
    return response.data;
  },

  getScanStatus: async (id: string): Promise<ScanStatusResponse> => {
    const response = await api.get<ScanStatusResponse>(`/scan/${id}/status`);
    return response.data;
  },

  getReport: async (id: string): Promise<ReportResponse> => {
    const response = await api.get<ReportResponse>(`/reports/${id}`);
    return response.data;
  },

  getReports: async (limit = 20, offset = 0): Promise<ScanResponse[]> => {
    const response = await api.get<ScanResponse[]>('/reports', {
      params: { limit, offset },
    });
    return response.data;
  },

  setBaseline: async (scanId: string, isBaseline: boolean): Promise<void> => {
    await api.post(`/scans/${scanId}/set-baseline`, { isBaseline });
  },

  getFlows: async (): Promise<FlowDefinition[]> => {
    var response = await api.get<FlowDefinition[]>('/flows');
    return response.data;
  },

  getFlow: async (id: string): Promise<FlowDefinition> => {
    var response = await api.get<FlowDefinition>('/flows/' + id);
    return response.data;
  },

  createFlow: async (name: string, steps: FlowStep[]): Promise<FlowDefinition> => {
    var response = await api.post<FlowDefinition>('/flows', { name, steps });
    return response.data;
  },

  updateFlow: async (id: string, name: string, steps: FlowStep[]): Promise<void> => {
    await api.put('/flows/' + id, { name, steps });
  },

  deleteFlow: async (id: string): Promise<void> => {
    await api.delete('/flows/' + id);
  },
};

export default api;

