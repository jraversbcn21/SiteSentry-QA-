import axios from 'axios';
import { ScanRequest, ScanResponse, ScanStatusResponse, ReportResponse } from '../types';

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
};

export default api;

