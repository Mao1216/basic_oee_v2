import React, { useState, useEffect, useRef } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, ComposedChart, ScatterChart, Scatter, ReferenceLine
} from 'recharts';
import {
  LayoutDashboard, ClipboardList, CheckSquare, Activity, History, Bot, Settings,
  LogOut, Bell, User, Play, Pause, AlertTriangle, AlertOctagon, Wrench, CheckCircle,
  ChevronRight, ArrowRight, Save, Send, Edit, X, Plus, Search, Filter, MessageSquare, Upload, Users,
  Eye, Download, Scale, PackageMinus, PackageCheck, Trash2
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { supabase } from './lib/supabase';

const BiomontLogo = ({ className = '' }) => (
  <svg viewBox="0 0 220 82" role="img" aria-label="Biomont" className={className}>
    <ellipse cx="110" cy="41" rx="106" ry="36" fill="#e30613" stroke="white" strokeWidth="3" />
    <text x="110" y="56" textAnchor="middle" fill="white" fontSize="48" fontWeight="700" fontFamily="Arial, sans-serif">Biomont</text>
  </svg>
);

const COLORS = {
  success: '#10b981', // emerald-500
  warning: '#f59e0b', // amber-500
  critical: '#f43f5e', // rose-500
  primary: '#2563eb', // blue-600
  neutral: '#64748b'  // slate-500
};

const getOEEColor = (value) => {
  if (value >= 85) return COLORS.success;
  if (value >= 70) return COLORS.warning;
  return COLORS.critical;
};

const timeToMinutes = (time) => {
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return 0;
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const elapsedMinutes = (start, end) => {
  if (!start || !end) return 0;
  let difference = timeToMinutes(end) - timeToMinutes(start);
  if (difference < 0) difference += 24 * 60;
  return difference;
};

const currentTimeInput = () => new Date().toTimeString().slice(0, 5);

const addMinutesToTime = (time, minutesToAdd) => {
  const base = timeToMinutes(time || '00:00');
  const total = (base + minutesToAdd) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const calculateDowntimeMetrics = (session) => {
  const operationMinutes = elapsedMinutes(session?.processStart, session?.processEnd);
  const plannedLosses = (session?.losses || []).filter(loss => loss.category === 'planned_availability');
  const unplannedLosses = (session?.losses || []).filter(loss => loss.category === 'availability');
  const plannedDowntimeMinutes = plannedLosses.reduce((sum, loss) => sum + Number(loss.duration || 0), 0);
  const downtimeMinutes = unplannedLosses.reduce((sum, loss) => sum + Number(loss.duration || 0), 0);
  const plannedProductionMinutes = Math.max(0, operationMinutes - plannedDowntimeMinutes);
  const productiveMinutes = Math.max(0, plannedProductionMinutes - downtimeMinutes);
  const machineSpeed = Math.max(0, Number(session?.machineSpeed || 0));
  const theoreticalUnits = productiveMinutes * machineSpeed;
  const totalUnits = session?.productionRegistered && machineSpeed > 0
    ? Math.max(0, Math.round(theoreticalUnits))
    : Math.max(0, Number(session?.realQty || 0));
  const goodUnits = Math.max(0, Number(session?.goodQty ?? (totalUnits - Number(session?.rejectQty || 0))));
  const availability = plannedProductionMinutes > 0 ? (productiveMinutes / plannedProductionMinutes) * 100 : 0;
  const performance = theoreticalUnits > 0 ? (totalUnits / theoreticalUnits) * 100 : 0;
  const quality = totalUnits > 0 ? (Math.min(goodUnits, totalUnits) / totalUnits) * 100 : 0;
  const boundedAvailability = Math.max(0, Math.min(100, availability));
  const boundedPerformance = Math.max(0, Math.min(100, performance));
  const boundedQuality = Math.max(0, Math.min(100, quality));
  const oee = (boundedAvailability / 100) * (boundedPerformance / 100) * (boundedQuality / 100) * 100;
  return {
    operationMinutes,
    plannedDowntimeMinutes,
    plannedProductionMinutes,
    downtimeMinutes,
    productiveMinutes,
    machineSpeed,
    totalUnits,
    goodUnits,
    theoreticalUnits,
    availability: boundedAvailability,
    performance,
    quality: boundedQuality,
    oee,
    incidents: unplannedLosses.length
  };
};

const monthLabels = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const getWeekKey = (dateText) => {
  const date = new Date(`${dateText || new Date().toISOString().slice(0, 10)}T00:00:00`);
  const start = new Date(date.getFullYear(), 0, 1);
  const week = Math.ceil((((date.getTime() - start.getTime()) / 86400000) + start.getDay() + 1) / 7);
  return `${date.getFullYear()}-S${String(week).padStart(2, '0')}`;
};

const DUMMY_USER = { name: "Carlos Mendoza", plant: "Planta Norte - Farma", id: "OP-042" };
const SHIFTS = ["Mañana (06:00 - 14:00)", "Tarde (14:00 - 22:00)", "Noche (22:00 - 06:00)"];
const PRODUCTION_LINE_OPERATORS = [
  { id: "OP-B01-001", name: "Omar Miraya", machines: ["Blistera B-01"] },
  { id: "OP-B01-002", name: "Aaron Flores", machines: ["Blistera B-01"] },
  { id: "OP-B01-003", name: "Josue Huapaya", machines: ["*"] }
];
const APP_PROFILES = {
  supervisor: { name: "Supervisor Biomont" },
  responsible_operator: { name: "Josue Huapaya", id: "OP-B01-003", machines: ["*"] }
};

const WORK_ORDER_STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  not_started: { label: 'Sin iniciar', variant: 'default' },
  in_progress: { label: 'En proceso', variant: 'success' },
  review: { label: 'En revisión', variant: 'warning' },
  observed: { label: 'Observado', variant: 'critical' },
  validated: { label: 'Validado', variant: 'success' }
};

const MACHINES = [
  { id: "B-01", name: "Blistera B-01", line: "Blistera", status: "available" },
  { id: "I-01", name: "Inyectora I-01", line: "Inyectora", status: "available" },
  { id: "T-01", name: "Tableteadora T-01", line: "Tableteadora", status: "available" },
  { id: "E-01", name: "Encapsuladora E-01", line: "Encapsuladora", status: "maintenance" },
  { id: "M-01", name: "Mezcladora M-01", line: "Mezcladora", status: "available" },
  { id: "L-02", name: "Llenadora L-02", line: "Llenadora", status: "occupied" },
  { id: "A-01", name: "Acondicionadora A-01", line: "Acondicionadora", status: "available" },
];

const MATERIAL_PRODUCTS = [
  { code: 'K1553', description: 'CAJA DE 20 X 20', unit: 'Unidad' },
  { code: 'K155', description: 'CAJA DE 50', unit: 'Unidad' },
  { code: 'ENV-001', description: 'Frasco PEAD', unit: 'unidades' },
  { code: 'ENV-002', description: 'Tapa rosca de seguridad', unit: 'unidades' },
  { code: 'ENV-003', description: 'Blíster PVC/Aluminio', unit: 'unidades' },
  { code: 'ACO-001', description: 'Caja plegadiza', unit: 'unidades' },
  { code: 'ACO-002', description: 'Inserto impreso', unit: 'unidades' },
  { code: 'ACO-003', description: 'Etiqueta autoadhesiva', unit: 'unidades' },
];

const LOSS_CAUSES = {
  planned_availability: ["Limpieza programada", "Cambio de formatos", "Mantenimiento preventivo", "Otros"],
  availability: ["Corte de servicios", "Avería mecánica", "Avería eléctrica", "Bloqueos", "Otros"],
  performance: ["Microparada de máquina", "Microparada de línea", "Atasco de material", "Ajuste menor", "Otros"],
  quality: ["Blister mal sellado", "Falta de lote/vencimiento", "Volumen incorrecto", "Contaminación cruzada"]
};

const normalizeLossCauses = (stored: Record<string, string[]> = {}) => Object.fromEntries(
  Object.entries(LOSS_CAUSES).map(([category, defaults]) => [
    category,
    Array.from(new Set([...defaults, ...(Array.isArray(stored?.[category]) ? stored[category] : [])]))
      .filter(cause => category !== 'availability' || !/\bTNI\b|falla no identificada/i.test(cause))
  ])
);
const CHART_DATA_TREND = [];
const CHART_DATA_PARETO = [];

const loadStoredCatalog = (key, fallback) => {
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
};

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';
type BadgeVariant = 'default' | 'success' | 'warning' | 'critical' | 'primary';

const Card = ({ children, className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div {...props} className={`bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden ${className}`}>
    {children}
  </div>
);

const Badge = ({ children, variant = 'default', className = '', ...props }: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) => {
  const variants: Record<BadgeVariant, string> = {
    default: "bg-slate-100 text-slate-700",
    success: "bg-emerald-100 text-emerald-700",
    warning: "bg-amber-100 text-amber-700",
    critical: "bg-rose-100 text-rose-700",
    primary: "bg-blue-100 text-blue-700"
  };
  return (
    <span {...props} className={`px-2.5 py-1 text-xs font-semibold rounded-full ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
};

const Button = ({ children, variant = 'primary', className = '', type = 'button', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) => {
  const baseStyle = "inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 shadow-sm",
    secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus:ring-slate-500",
    danger: "bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-500 shadow-sm",
    success: "bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500 shadow-sm",
    ghost: "bg-transparent text-slate-600 hover:bg-slate-100"
  };
  return (
    <button {...props} type={type} className={`${baseStyle} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
};

const Modal = ({ isOpen, onClose, title, children }: { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
          <h3 className="text-lg font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
};

const TimeField = ({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) => {
  const [hour = '00', minute = '00'] = (value || '00:00').split(':');
  const update = (nextHour: string, nextMinute: string) => onChange(`${nextHour}:${nextMinute}`);
  return (
    <div className="min-w-44">
      <label className="mb-1 block text-xs font-medium text-slate-400">{label}</label>
      <div className="flex items-center gap-1 rounded-lg border border-slate-500 bg-white p-1 text-slate-900 shadow-inner">
        <select aria-label={`${label}: hora`} value={hour} onChange={(event) => update(event.target.value, minute)} className="w-full rounded border-0 bg-transparent px-2 py-1.5 font-semibold outline-none">
          {Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0')).map(option => <option key={option}>{option}</option>)}
        </select>
        <span className="font-bold text-slate-400">:</span>
        <select aria-label={`${label}: minutos`} value={minute} onChange={(event) => update(hour, event.target.value)} className="w-full rounded border-0 bg-transparent px-2 py-1.5 font-semibold outline-none">
          {Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0')).map(option => <option key={option}>{option}</option>)}
        </select>
      </div>
    </div>
  );
};

const RecordDetails = ({ record }: { record: any; metrics?: any; readOnly?: boolean }) => {
  if (!record) return null;
  const metrics = calculateDowntimeMetrics(record);
  const losses = (record.losses || []).filter(loss => ['availability', 'planned_availability', 'quality'].includes(loss.category));
  const tickets = losses.filter(loss => loss.ticketCode || loss.ticket);
  return <div className="space-y-5"><div className="grid grid-cols-2 gap-4"><div><p className="text-xs text-slate-500">Lote</p><p className="font-bold">{record.lot || 'Sin lote'}</p></div><div><p className="text-xs text-slate-500">OT</p><p className="font-bold">{record.workOrderId || record.id}</p></div><div><p className="text-xs text-slate-500">Equipo</p><p className="font-semibold">{record.machine}</p></div><div><p className="text-xs text-slate-500">Operario</p><p className="font-semibold">{record.operator || record.registrar || 'Sin registrador'}</p></div></div><div className="grid gap-2 sm:grid-cols-4">{[['Tiempo operación',metrics.operationMinutes,' min'],['Det. no planificadas',metrics.downtimeMinutes,' min'],['Disponibilidad',metrics.availability,'%'],['OEE',metrics.oee,'%']].map(([label,value,unit]) => <div key={label} className="rounded-lg bg-slate-50 p-3 text-center"><p className="text-xs text-slate-500">{label}</p><p className="font-bold">{Number(value).toFixed(unit === '%' ? 2 : 0)}{unit}</p></div>)}</div><div><h4 className="mb-2 font-bold text-slate-800">Registros de la OT</h4>{losses.length ? <div className="space-y-2">{losses.map(loss => <div key={loss.id} className={`rounded-lg border p-3 text-sm ${loss.category === 'planned_availability' ? 'border-sky-200 bg-sky-50' : loss.category === 'quality' ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}><div className="flex justify-between gap-3"><p className="font-bold text-slate-900">{loss.category === 'quality' ? 'Producción real' : loss.cause}</p><p className="font-bold">{loss.category === 'quality' ? `${Number(loss.goodQty || 0).toLocaleString()} und buenas` : `${Number(loss.duration || 0)} min`}</p></div><p className="mt-1 text-slate-600">{loss.comment || 'Sin comentario'}</p>{loss.category === 'planned_availability' && Number(loss.supportPersonnelCount || loss.supportOperators?.length || 0) > 0 && <p className="mt-1 text-xs font-medium text-sky-700">Personal de apoyo: {Number(loss.supportPersonnelCount || loss.supportOperators?.length || 0)} persona(s)</p>}</div>)}</div> : <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Sin registros.</p>}</div>{tickets.length > 0 && <div><h4 className="mb-2 font-bold text-slate-800">Tickets de mantenimiento</h4><div className="space-y-2">{tickets.map(loss => <div key={loss.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><p className="font-bold text-amber-900">{loss.ticketCode || loss.ticket?.code}</p><p className="mt-1 text-slate-600">{loss.ticket?.detail || loss.comment || 'Sin detalle adicional'}</p></div>)}</div></div>}</div>;
};

export default function OEEApplication() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [role, setRole] = useState(null); // 'supervisor', 'responsible_operator'
  const [currentView, setCurrentView] = useState('dashboard');
  const [loginOperatorId, setLoginOperatorId] = useState('OP-B01-003');
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  
  // App Data State
  const [records, setRecords] = useState(() => loadStoredCatalog('bioee-records', []));
  const [workOrders, setWorkOrders] = useState(() => loadStoredCatalog('bioee-work-orders', []));
  const [productionLineOperators, setProductionLineOperators] = useState(() => loadStoredCatalog('bioee-production-line-operators', PRODUCTION_LINE_OPERATORS));
  const [plantEquipment, setPlantEquipment] = useState(() => loadStoredCatalog('bioee-plant-equipment-v2', MACHINES));
  const [lossCauses, setLossCauses] = useState(() => {
    const stored = loadStoredCatalog('bioee-loss-causes', LOSS_CAUSES);
    return normalizeLossCauses(stored);
  });
  const [adminSection, setAdminSection] = useState('');
  const [adminPlantSection, setAdminPlantSection] = useState('');
  const [adminLossCategory, setAdminLossCategory] = useState('availability');
  const [adminNewCause, setAdminNewCause] = useState('');
  const [adminOperatorForm, setAdminOperatorForm] = useState({ name: '', machines: [] as string[] });
  const [adminEditingOperatorId, setAdminEditingOperatorId] = useState('');
  const [adminEquipmentForm, setAdminEquipmentForm] = useState({ name: '', line: '' });
  const [adminEditingEquipmentId, setAdminEditingEquipmentId] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [workOrderFilters, setWorkOrderFilters] = useState({ code: '', lot: '', product: '', line: '', quantity: '', status: '', registrar: '' });
  const workOrdersFileInputRef = useRef(null);
  const [selectedLiveOrder, setSelectedLiveOrder] = useState(null);
  const [dashboardOverweightProduct, setDashboardOverweightProduct] = useState('');
  const [dashboardDiscardProduct, setDashboardDiscardProduct] = useState('');
  const [dashboardDiscardType, setDashboardDiscardType] = useState('');
  const [dashboardOeePeriod, setDashboardOeePeriod] = useState('month');
  const [dashboardLaborLine, setDashboardLaborLine] = useState('');
  const [dashboardLaborEquipment, setDashboardLaborEquipment] = useState('');
  const [dashboardLot, setDashboardLot] = useState('');
  const [dashboardOrder, setDashboardOrder] = useState('');
  const [remoteSyncReady, setRemoteSyncReady] = useState(false);
  const [remoteSyncStatus, setRemoteSyncStatus] = useState(supabase ? 'Conectando datos compartidos…' : 'Datos guardados en este dispositivo');
  const applyingRemoteState = useRef(false);
  
  // Active Operator Session State
  const [activeSession, setActiveSession] = useState(() => loadStoredCatalog('bioee-active-session', null));

  const currentUser = role === 'responsible_operator'
    ? (productionLineOperators.find(operator => operator.id === loginOperatorId) || APP_PROFILES.responsible_operator)
    : role ? APP_PROFILES[role] : null;

  const applySharedState = (sharedData) => {
    if (!sharedData || typeof sharedData !== 'object') return;
    applyingRemoteState.current = true;
    if (Array.isArray(sharedData.records)) setRecords(sharedData.records);
    if (Array.isArray(sharedData.workOrders)) setWorkOrders(sharedData.workOrders);
    if (Array.isArray(sharedData.productionLineOperators)) {
      setProductionLineOperators(sharedData.productionLineOperators.length ? sharedData.productionLineOperators : PRODUCTION_LINE_OPERATORS);
    }
    if (Array.isArray(sharedData.plantEquipment)) {
      setPlantEquipment(sharedData.plantEquipment.length ? sharedData.plantEquipment : MACHINES);
    }
    if (sharedData.lossCauses && typeof sharedData.lossCauses === 'object' && Object.keys(sharedData.lossCauses).length) {
      setLossCauses(normalizeLossCauses(sharedData.lossCauses));
    }
    setActiveSession(sharedData.activeSession || null);
    window.setTimeout(() => { applyingRemoteState.current = false; }, 0);
  };

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    const initialData = { records, workOrders, productionLineOperators, plantEquipment, lossCauses, activeSession };
    const connectSharedState = async () => {
      const { data, error } = await supabase.from('bioee_shared_state').select('data').eq('id', 'main').maybeSingle();
      if (!mounted) return;
      if (error) {
        setRemoteSyncStatus('Sincronización pendiente');
        return;
      }
      if (data?.data) {
        applySharedState(data.data);
        setRemoteSyncReady(true);
        setRemoteSyncStatus('Datos compartidos sincronizados');
        return;
      }
      const hasLocalProductionData = workOrders.length > 0 || records.length > 0 || Boolean(activeSession);
      if (hasLocalProductionData) {
        const { error: seedError } = await supabase.from('bioee_shared_state').upsert({ id: 'main', data: initialData, updated_at: new Date().toISOString() });
        if (!seedError && mounted) {
          setRemoteSyncReady(true);
          setRemoteSyncStatus('Datos locales compartidos con Supabase');
        }
      } else {
        setRemoteSyncStatus('Esperando datos compartidos');
      }
    };
    void connectSharedState();
    const channel = supabase.channel('bioee-shared-state')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bioee_shared_state', filter: 'id=eq.main' }, payload => {
        const nextSharedData = (payload.new as { data?: any })?.data;
        if (!mounted || !nextSharedData) return;
        applySharedState(nextSharedData);
        setRemoteSyncReady(true);
        setRemoteSyncStatus('Datos actualizados en tiempo real');
      })
      .subscribe();
    return () => { mounted = false; void supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (!supabase || !remoteSyncReady || applyingRemoteState.current) return;
    const timer = window.setTimeout(async () => {
      const sharedData = { records, workOrders, productionLineOperators, plantEquipment, lossCauses, activeSession };
      const { error } = await supabase.from('bioee_shared_state').upsert({ id: 'main', data: sharedData, updated_at: new Date().toISOString() });
      setRemoteSyncStatus(error ? 'No se pudo sincronizar' : 'Datos compartidos sincronizados');
    }, 600);
    return () => window.clearTimeout(timer);
  }, [records, workOrders, productionLineOperators, plantEquipment, lossCauses, activeSession, remoteSyncReady]);

  useEffect(() => { window.localStorage.setItem('bioee-production-line-operators', JSON.stringify(productionLineOperators)); }, [productionLineOperators]);
  useEffect(() => { window.localStorage.setItem('bioee-plant-equipment-v2', JSON.stringify(plantEquipment)); }, [plantEquipment]);
  useEffect(() => { window.localStorage.setItem('bioee-loss-causes', JSON.stringify(lossCauses)); }, [lossCauses]);
  useEffect(() => { window.localStorage.setItem('bioee-work-orders', JSON.stringify(workOrders)); }, [workOrders]);
  useEffect(() => { window.localStorage.setItem('bioee-records', JSON.stringify(records)); }, [records]);
  useEffect(() => {
    if (activeSession) window.localStorage.setItem('bioee-active-session', JSON.stringify(activeSession));
    else window.localStorage.removeItem('bioee-active-session');
  }, [activeSession]);

  const enterWithRole = (selectedRole) => {
    setRole(selectedRole);
    setIsLoggedIn(true);
    setCurrentView(selectedRole === 'responsible_operator' ? 'work_orders' : 'dashboard');
  };

  const logout = () => {
    setIsLoggedIn(false);
    setRole(null);
  };

  const getImportValue = (row, aliases) => {
    const normalizedAliases = aliases.map(alias => alias.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const entry = Object.entries(row).find(([key]) =>
      normalizedAliases.includes(String(key).toLowerCase().replace(/[^a-z0-9]/g, ''))
    );
    return entry ? entry[1] : '';
  };

  const parsePlannedQuantity = (value) => {
    if (typeof value === 'number') return value;
    const text = String(value ?? '').trim();
    if (!text) return 0;
    const normalized = text.includes(',')
      ? text.replace(/\./g, '').replace(',', '.')
      : text.replace(/[^0-9.-]/g, '');
    return Number(normalized) || 0;
  };

  const handleWorkOrdersImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

      const importedOrders = rows.map((row, index) => {
        const id = String(getImportValue(row, ['Código OT', 'Codigo OT', 'OT', 'Orden', 'Orden de trabajo', 'ID'])).trim();
        const statusText = String(getImportValue(row, ['Estado', 'Status'])).toLowerCase();
        return {
          id,
          lot: String(getImportValue(row, ['Lote', 'Número de lote', 'Numero de lote', 'Lot'])).trim() || 'Sin lote',
          product: String(getImportValue(row, ['Producto', 'Descripción', 'Descripcion', 'Material'])).trim() || 'Sin producto',
          line: String(getImportValue(row, ['Línea', 'Linea', 'Línea/Máquina', 'Linea/Maquina'])).trim() || 'Sin línea',
          machine: String(getImportValue(row, ['Máquina', 'Maquina', 'Equipo'])).trim() || 'Sin máquina',
          plannedQty: parsePlannedQuantity(getImportValue(row, ['Planificado', 'Cantidad planificada', 'Cantidad', 'Qty'])),
          plannedWorkerHours: parsePlannedQuantity(getImportValue(row, ['Horas planificadas del operario', 'Horas planificadas', 'Horas operario', 'Planned worker hours'])),
          status: 'not_started',
          registrar: '',
          date: String(getImportValue(row, ['Fecha', 'Fecha OT', 'Date'])).trim()
        };
      }).filter(order => order.id);

      if (!importedOrders.length) {
        throw new Error('El archivo no contiene filas de órdenes de trabajo.');
      }

      setWorkOrders(importedOrders);
      setImportMessage(`${importedOrders.length} orden(es) de trabajo cargada(s) desde ${file.name}.`);
    } catch (error) {
      setImportMessage('No se pudo leer el Excel. Verifica que la primera hoja incluya el listado de OT.');
    } finally {
      event.target.value = '';
    }
  };

  const downloadWorkOrderTemplate = () => {
    const worksheet = XLSX.utils.json_to_sheet([{
      Lote: '', 'Código OT': '', Producto: '', Línea: '', Máquina: '', 'Cantidad planificada': ''
    }]);
    worksheet['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 32 }, { wch: 24 }, { wch: 24 }, { wch: 22 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Ordenes OT');
    XLSX.writeFile(workbook, 'Plantilla_Ordenes_OT_Biomont.xlsx');
  };

  // Helper to calculate active session OEE
  const calculateSessionMetrics = (session) => {
    if (!session) return { a: 0, p: 0, q: 0, oee: 0 };
    const baseMetrics = calculateDowntimeMetrics(session);
    const losses = Array.isArray(session.losses) ? session.losses : [];
    const perfLoss = losses.filter(loss => loss.category === 'performance').reduce((sum, loss) => sum + Number(loss.duration || 0), 0);
    const plannedQuantity = Number(session.plannedQty ?? session.plannedQuantity ?? 0);
    const theoreticalPlannedMinutes = baseMetrics.machineSpeed > 0 ? plannedQuantity / baseMetrics.machineSpeed : 0;
    const registeredStoppageMinutes = baseMetrics.plannedDowntimeMinutes + baseMetrics.downtimeMinutes;
    const tni = Math.max(0, theoreticalPlannedMinutes - (baseMetrics.operationMinutes + registeredStoppageMinutes));
    const reportedSpeed = baseMetrics.productiveMinutes > 0 ? baseMetrics.totalUnits / baseMetrics.productiveMinutes : 0;
    const effectiveSpeed = reportedSpeed;

    return {
      a: baseMetrics.availability,
      p: baseMetrics.performance,
      q: baseMetrics.quality,
      oee: baseMetrics.oee,
      operatingTime: baseMetrics.productiveMinutes,
      availLoss: baseMetrics.downtimeMinutes,
      microStopMinutes: perfLoss,
      machineSpeed: baseMetrics.machineSpeed,
      reportedSpeed,
      effectiveSpeed,
      processMinutes: baseMetrics.operationMinutes,
      plannedTimeMin: baseMetrics.plannedProductionMinutes,
      theoreticalProduction: baseMetrics.theoreticalUnits,
      plannedExclusions: baseMetrics.plannedDowntimeMinutes,
      theoreticalPlannedMinutes,
      registeredStoppageMinutes,
      tni
    };
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="p-8 bg-blue-600 text-center">
            <BiomontLogo className="w-52 h-auto mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-white">BIOEE B</h1>
          </div>
          <div className="space-y-4 p-8">
            <div className="text-center">
              <h2 className="text-lg font-bold text-slate-900">Selecciona tu usuario</h2>
            </div>
            <button type="button" onClick={() => enterWithRole('responsible_operator')} className="flex w-full items-center gap-4 rounded-xl border-2 border-blue-100 p-4 text-left transition hover:border-blue-500 hover:bg-blue-50">
              <span className="rounded-xl bg-blue-100 p-3 text-blue-700"><User size={24} /></span>
              <span className="font-bold text-slate-900">Operario</span>
            </button>
            <button type="button" onClick={() => enterWithRole('supervisor')} className="flex w-full items-center gap-4 rounded-xl border-2 border-emerald-100 p-4 text-left transition hover:border-emerald-500 hover:bg-emerald-50">
              <span className="rounded-xl bg-emerald-100 p-3 text-emerald-700"><CheckSquare size={24} /></span>
              <span className="font-bold text-slate-900">Supervisor</span>
            </button>
            <p className="text-center text-xs text-emerald-700">{remoteSyncStatus}</p>
          </div>
        </div>
      </div>
    );
  }

  const SidebarItem = ({ icon: Icon, label, viewId, requiredRole }: { icon: React.ElementType; label: string; viewId: string; requiredRole?: string }) => {
    if (requiredRole && requiredRole !== role && role !== 'admin') return null;
    const isActive = currentView === viewId;
    return (
      <button
        onClick={() => setCurrentView(viewId)}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
          isActive ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
        }`}
      >
        <Icon size={20} />
        {isSidebarOpen && <span>{label}</span>}
      </button>
    );
  };

  const LegacyDashboardView = () => (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Dashboard de Planta</h2>
          <p className="text-slate-500">Resumen de indicadores OEE - Planta Norte</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="!py-2">Hoy</Button>
          <Button variant="secondary" className="!py-2">Esta Semana</Button>
          <Button variant="secondary" className="!py-2"><Filter size={16} /> Filtros</Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10"><Activity size={64} /></div>
          <p className="text-sm font-medium text-slate-500 mb-1">OEE Global Actual</p>
          <div className="flex items-end gap-3">
            <h3 className="text-4xl font-bold text-amber-500">76.4%</h3>
            <span className="text-sm font-medium text-rose-500 mb-1">▼ 2.1%</span>
          </div>
          <div className="mt-4 w-full bg-slate-100 rounded-full h-2">
            <div className="bg-amber-500 h-2 rounded-full" style={{ width: '76.4%' }}></div>
          </div>
          <p className="text-xs text-slate-500 mt-2">Objetivo: 85%</p>
        </Card>
        
        <Card className="p-6">
          <p className="text-sm font-medium text-slate-500 mb-1">Disponibilidad</p>
          <h3 className="text-3xl font-bold text-slate-800">88.2%</h3>
          <div className="mt-4 flex justify-between text-xs text-slate-500 border-t pt-2">
            <span>T. Planificado: 480m</span>
            <span>T. Operativo: 423m</span>
          </div>
        </Card>

        <Card className="p-6">
          <p className="text-sm font-medium text-slate-500 mb-1">Velocidad de equipo</p>
          <h3 className="text-3xl font-bold text-slate-800">89.5%</h3>
          <div className="mt-4 flex justify-between text-xs text-slate-500 border-t pt-2">
            <span>Vel. Ideal: 100/m</span>
            <span>Vel. Real: 89/m</span>
          </div>
        </Card>

        <Card className="p-6">
          <p className="text-sm font-medium text-slate-500 mb-1">Calidad</p>
          <h3 className="text-3xl font-bold text-emerald-500">96.8%</h3>
          <div className="mt-4 flex justify-between text-xs text-slate-500 border-t pt-2">
            <span>Producido: 37.8k</span>
            <span className="text-rose-500">Rechazo: 1.2k</span>
          </div>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-6 lg:col-span-2">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Tendencia OEE (Últimos 7 días)</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={CHART_DATA_TREND}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fill: '#64748b'}} />
                <YAxis domain={[60, 100]} axisLine={false} tickLine={false} tick={{fill: '#64748b'}} />
                <RechartsTooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Legend />
                <Line type="monotone" dataKey="oee" name="OEE" stroke={COLORS.primary} strokeWidth={3} dot={{r: 4}} activeDot={{r: 6}} />
                <Line type="monotone" dataKey="a" name="Disp." stroke={COLORS.warning} strokeWidth={2} strokeDasharray="5 5" />
                <Line type="monotone" dataKey="p" name="Rend." stroke="#8b5cf6" strokeWidth={2} strokeDasharray="5 5" />
                <Line type="monotone" dataKey="q" name="Calidad" stroke={COLORS.success} strokeWidth={2} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-bold text-slate-800 mb-6">Pareto de Pérdidas (Minutos)</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={CHART_DATA_PARETO} margin={{top: 20, right: 20, bottom: 20, left: 0}}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="cause" scale="band" tick={{fontSize: 10, fill: '#64748b'}} interval={0} angle={-45} textAnchor="end" />
                <YAxis yAxisId="left" tick={{fontSize: 12}} />
                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{fontSize: 12}} tickFormatter={(v)=>`${v}%`} />
                <RechartsTooltip />
                <Bar yAxisId="left" dataKey="minutes" fill="#ef4444" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="cumulative" stroke="#0f172a" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );

  const BasicDashboardView = () => {
    const liveRecord = activeSession ? { ...activeSession, workOrderId: activeSession.id, status: 'in_progress' } : null;
    const allRecords = [...records, ...(liveRecord ? [liveRecord] : [])];
    const lots = Array.from(new Set(allRecords.map(record => record.lot).filter(Boolean))).sort();
    const orders = dashboardLot ? Array.from(new Set(allRecords.filter(record => record.lot === dashboardLot).map(record => record.workOrderId || record.id))).sort() : [];
    const filteredRecords = allRecords.filter(record => (!dashboardLot || record.lot === dashboardLot) && (!dashboardOrder || (record.workOrderId || record.id) === dashboardOrder));
    const metrics = filteredRecords.map(record => ({ record, ...calculateDowntimeMetrics(record) }));
    const operationMinutes = metrics.reduce((sum, item) => sum + item.operationMinutes, 0);
    const plannedProductionMinutes = metrics.reduce((sum, item) => sum + item.plannedProductionMinutes, 0);
    const downtimeMinutes = metrics.reduce((sum, item) => sum + item.downtimeMinutes, 0);
    const productiveMinutes = metrics.reduce((sum, item) => sum + item.productiveMinutes, 0);
    const availability = plannedProductionMinutes > 0 ? productiveMinutes / plannedProductionMinutes * 100 : 0;
    const totalUnits = metrics.reduce((sum, item) => sum + item.totalUnits, 0);
    const goodUnits = metrics.reduce((sum, item) => sum + item.goodUnits, 0);
    const theoreticalUnits = metrics.reduce((sum, item) => sum + item.theoreticalUnits, 0);
    const performance = theoreticalUnits > 0 ? Math.min(100, totalUnits / theoreticalUnits * 100) : 0;
    const quality = totalUnits > 0 ? Math.min(100, goodUnits / totalUnits * 100) : 0;
    const consolidatedOee = Math.max(0, Math.min(100, availability)) / 100 * performance / 100 * quality / 100 * 100;
    const causeMap = filteredRecords.flatMap(record => (record.losses || []).filter(loss => loss.category === 'availability')).reduce((summary, loss) => {
      summary[loss.cause] = (summary[loss.cause] || 0) + Number(loss.duration || 0);
      return summary;
    }, {});
    const causes = Object.entries(causeMap).map(([cause, minutes]) => ({ cause, minutes: Number(minutes) })).sort((a, b) => b.minutes - a.minutes);
    const totalLoss = causes.reduce((sum, item) => sum + item.minutes, 0);
    let accumulated = 0;
    const pareto = causes.map(item => { accumulated += item.minutes; return { ...item, cumulative: totalLoss ? accumulated / totalLoss * 100 : 0 }; });
    const machineMap = filteredRecords.reduce((summary, record) => {
      const machine = record.machine || 'Sin equipo';
      if (!summary[machine]) summary[machine] = { machine, minutes: 0, incidents: 0 };
      const rowMetrics = calculateDowntimeMetrics(record);
      summary[machine].minutes += rowMetrics.downtimeMinutes;
      summary[machine].incidents += rowMetrics.incidents;
      return summary;
    }, {});
    const machines = Object.values(machineMap).sort((a: any, b: any) => b.minutes - a.minutes);

    return <div className="space-y-6 animate-in fade-in duration-300">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-700 p-7 text-white shadow-xl"><div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-200">Centro de control · BIOEE B</p><h2 className="mt-3 text-4xl font-bold">OEE</h2><p className="mt-2 text-blue-100">Seguimiento de producción y disponibilidad por lote y OT.</p></div><div className="grid gap-3 sm:grid-cols-2"><div><label className="mb-1 block text-xs font-semibold text-blue-100">Lote</label><select className="min-w-52 rounded-lg border border-white/20 bg-white p-3 text-slate-900" value={dashboardLot} onChange={event => { setDashboardLot(event.target.value); setDashboardOrder(''); }}><option value="">Todos los lotes</option>{lots.map(lot => <option key={lot}>{lot}</option>)}</select></div><div><label className="mb-1 block text-xs font-semibold text-blue-100">OT</label><select className="min-w-52 rounded-lg border border-white/20 bg-white p-3 text-slate-900 disabled:opacity-60" value={dashboardOrder} disabled={!dashboardLot} onChange={event => setDashboardOrder(event.target.value)}><option value="">Todas las OT</option>{orders.map(order => <option key={order}>{order}</option>)}</select></div></div></div></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Card className="border-l-4 border-l-blue-500 p-5"><p className="text-sm text-slate-500">Tiempo de operación</p><p className="mt-1 text-3xl font-bold text-slate-900">{operationMinutes.toFixed(0)} min</p></Card><Card className="border-l-4 border-l-rose-500 p-5"><p className="text-sm text-slate-500">Detención no planificada</p><p className="mt-1 text-3xl font-bold text-rose-600">{downtimeMinutes.toFixed(0)} min</p></Card><Card className="border-l-4 border-l-emerald-500 p-5"><p className="text-sm text-slate-500">Disponibilidad</p><p className="mt-1 text-3xl font-bold text-emerald-600">{availability.toFixed(2)}%</p></Card><Card className="border-l-4 border-l-amber-500 p-5"><p className="text-sm text-slate-500">OEE</p><p className="mt-1 text-3xl font-bold" style={{color: getOEEColor(consolidatedOee)}}>{consolidatedOee.toFixed(2)}%</p></Card></div>
      <div className="grid gap-6 xl:grid-cols-2"><Card className="p-6"><h3 className="text-lg font-bold text-slate-900">Pareto de detenciones</h3><p className="mb-5 text-sm text-slate-500">Causas ordenadas de mayor a menor por minutos perdidos.</p><div className="h-80">{pareto.length ? <ResponsiveContainer><ComposedChart data={pareto} margin={{top:10,right:10,bottom:65,left:0}}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="cause" interval={0} angle={-30} textAnchor="end" height={85}/><YAxis yAxisId="minutes"/><YAxis yAxisId="percentage" orientation="right" domain={[0,100]} tickFormatter={value => `${value}%`}/><RechartsTooltip/><Bar yAxisId="minutes" dataKey="minutes" name="Minutos" fill="#f43f5e" radius={[6,6,0,0]}/><Line yAxisId="percentage" dataKey="cumulative" name="Acumulado" stroke="#0f172a" strokeWidth={3}/></ComposedChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-slate-400">Sin detenciones para los filtros seleccionados.</div>}</div></Card><Card className="p-6"><h3 className="text-lg font-bold text-slate-900">Pérdida por equipo</h3><p className="mb-5 text-sm text-slate-500">Minutos de detención acumulados.</p><div className="h-80">{machines.length ? <ResponsiveContainer><BarChart data={machines} layout="vertical" margin={{left:30}}><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number"/><YAxis type="category" dataKey="machine" width={120}/><RechartsTooltip/><Bar dataKey="minutes" name="Minutos" fill="#2563eb" radius={[0,6,6,0]}/></BarChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-slate-400">Sin información registrada.</div>}</div></Card></div>
      <Card><div className="border-b border-slate-200 p-5"><h3 className="text-lg font-bold text-slate-900">Resumen por OT</h3></div><div className="overflow-x-auto"><table className="w-full text-left"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-4">Lote</th><th className="p-4">OT</th><th className="p-4">Equipo</th><th className="p-4 text-right">Operación</th><th className="p-4 text-right">Detenciones</th><th className="p-4 text-right">Disponibilidad</th><th className="p-4 text-right">OEE</th></tr></thead><tbody className="divide-y divide-slate-100">{metrics.map(({record,...item}) => <tr key={record.id}><td className="p-4 font-medium">{record.lot || '-'}</td><td className="p-4">{record.workOrderId || record.id}</td><td className="p-4">{record.machine}</td><td className="p-4 text-right">{item.operationMinutes.toFixed(0)} min</td><td className="p-4 text-right font-bold text-rose-600">{item.downtimeMinutes.toFixed(0)} min</td><td className="p-4 text-right font-bold">{item.availability.toFixed(2)}%</td><td className="p-4 text-right font-bold" style={{color: getOEEColor(item.oee)}}>{item.oee.toFixed(2)}%</td></tr>)}{!metrics.length && <tr><td colSpan={7} className="p-8 text-center text-slate-500">No hay registros para mostrar.</td></tr>}</tbody></table></div></Card>
    </div>;
  };

  const DashboardView = () => {
    const liveRecord = activeSession ? { ...activeSession, id: `LIVE-${activeSession.id}`, date: new Date().toISOString().slice(0, 10), metrics: calculateSessionMetrics(activeSession), status: 'in_progress' } : null;
    const allSourceRecords = [...records, ...(liveRecord ? [liveRecord] : [])];
    const dashboardLots = Array.from(new Set(allSourceRecords.map(record => record.lot).filter(Boolean))).sort();
    const dashboardOrders = dashboardLot ? Array.from(new Set(allSourceRecords.filter(record => record.lot === dashboardLot).map(record => record.workOrderId || String(record.id).replace(/^LIVE-|^REC-/, '')).filter(Boolean))).sort() : [];
    const sourceRecords = allSourceRecords.filter(record => (!dashboardLot || record.lot === dashboardLot) && (!dashboardOrder || (record.workOrderId || String(record.id).replace(/^LIVE-|^REC-/, '')) === dashboardOrder)).map(record => ({ ...record, metrics: calculateSessionMetrics(record) }));
    const products = Array.from(new Set(sourceRecords.map(record => record.product).filter(Boolean)));
    const lossMap = sourceRecords.flatMap(record => record.losses || []).filter(loss => loss.category === 'availability' || loss.category === 'planned_availability').reduce((map, loss) => {
      map[loss.cause] = (map[loss.cause] || 0) + Number(loss.duration || 0);
      return map;
    }, {});
    const sortedLosses = Object.entries(lossMap).map(([cause, minutes]) => ({ cause, minutes: Number(minutes) })).sort((first, second) => second.minutes - first.minutes);
    const totalParetoMinutes = sortedLosses.reduce((sum, item) => sum + item.minutes, 0);
    let cumulativeMinutes = 0;
    const paretoData = sortedLosses.map(item => {
      cumulativeMinutes += item.minutes;
      return { ...item, cumulative: totalParetoMinutes ? (cumulativeMinutes / totalParetoMinutes) * 100 : 0 };
    });
    const overweightData = dashboardOverweightProduct ? sourceRecords.filter(record => record.product === dashboardOverweightProduct).flatMap(record => (record.overweights || []).map((item, index) => ({
      time: item.time || addMinutesToTime(record.processStart || '00:00', (index + 1) * 30), weight: Number(item.weight), quantity: Number(item.quantity), product: record.product
    }))).sort((first, second) => timeToMinutes(first.time) - timeToMinutes(second.time)) : [];
    const configuredTarget = dashboardOverweightProduct ? sourceRecords.find(record => record.product === dashboardOverweightProduct && Number(record.targetWeight) > 0)?.targetWeight : 0;
    const centralWeight = Number(configuredTarget) || (overweightData.length ? overweightData.reduce((sum, item) => sum + item.weight * item.quantity, 0) / overweightData.reduce((sum, item) => sum + item.quantity, 0) : 0);
    const upperWeightTolerance = centralWeight + 0.5;
    const lowerWeightTolerance = centralWeight - 0.5;
    const weightZoomMargin = 2;
    const weightZoomDomain = [
      Math.max(0, centralWeight - weightZoomMargin),
      centralWeight + weightZoomMargin
    ];
    const weightsOutsideZoom = overweightData.filter(item => item.weight < weightZoomDomain[0] || item.weight > weightZoomDomain[1]).length;
    const temporalGroups = sourceRecords.reduce((summary, record) => {
      const dateText = record.date || new Date().toISOString().slice(0, 10);
      const date = new Date(`${dateText}T00:00:00`);
      const key = dashboardOeePeriod === 'month' ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : dashboardOeePeriod === 'week' ? getWeekKey(dateText) : dateText;
      const label = dashboardOeePeriod === 'month' ? `${monthLabels[date.getMonth()]} ${date.getFullYear()}` : dashboardOeePeriod === 'week' ? key.replace('-', ' · ') : date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
      const weight = Number(record.metrics?.plannedTimeMin || 0) || 1;
      if (!summary[key]) summary[key] = { key, label, weightedOee: 0, weight: 0 };
      summary[key].weightedOee += Number(record.metrics?.oee || 0) * weight;
      summary[key].weight += weight;
      return summary;
    }, {});
    const temporalOeeData = Object.values(temporalGroups).sort((first: any, second: any) => first.key.localeCompare(second.key)).map((item: any) => ({ period: item.label, oee: item.weight ? item.weightedOee / item.weight : 0 }));
    const totalShiftMinutes = sourceRecords.reduce((sum, record) => sum + elapsedMinutes(record.processStart, record.processEnd), 0);
    const totalPlannedExclusions = sourceRecords.flatMap(record => record.losses || []).filter(loss => loss.category === 'planned_availability').reduce((sum, loss) => sum + Number(loss.duration || 0), 0);
    const plannedMinutes = Math.max(0, totalShiftMinutes - totalPlannedExclusions);
    const totalDowntime = sourceRecords.flatMap(record => record.losses || []).filter(loss => loss.category === 'availability').reduce((sum, loss) => sum + Number(loss.duration || 0), 0);
    const operatingMinutes = Math.max(0, plannedMinutes - totalDowntime);
    const totalProduction = sourceRecords.reduce((sum, record) => sum + Number(record.realQty || 0), 0);
    const theoreticalProduction = sourceRecords.reduce((sum, record) => {
      const recordMinutes = Math.max(0, elapsedMinutes(record.processStart, record.processEnd) - (record.losses || []).filter(loss => ['planned_availability', 'availability'].includes(loss.category)).reduce((lossSum, loss) => lossSum + Number(loss.duration || 0), 0));
      return sum + recordMinutes * Number(record.machineSpeed || 0);
    }, 0);
    const goodProduction = sourceRecords.reduce((sum, record) => sum + Math.max(0, Number(record.realQty || 0) - Number(record.rejectQty || 0)), 0);
    const qualityLossMinutes = sourceRecords.reduce((sum, record) => {
      const speed = Number(record.machineSpeed || 0);
      return sum + (speed > 0 ? Number(record.rejectQty || 0) / speed : 0);
    }, 0);
    const speedLossMinutes = sourceRecords.reduce((sum, record) => {
      const speed = Number(record.machineSpeed || 0);
      if (speed <= 0) return sum;
      const recordOperatingMinutes = Math.max(0, elapsedMinutes(record.processStart, record.processEnd) - (record.losses || []).filter(loss => ['planned_availability', 'availability'].includes(loss.category)).reduce((lossSum, loss) => lossSum + Number(loss.duration || 0), 0));
      return sum + Math.max(0, recordOperatingMinutes - Number(record.realQty || 0) / speed);
    }, 0);
    const lossTreeItems = [
      { key: 'planned', label: 'Planificadas', minutes: totalPlannedExclusions, detail: 'Limpieza, cambio y mantenimiento', box: 'border-sky-200 bg-sky-50', title: 'text-sky-800', value: 'text-sky-700', detailColor: 'text-sky-600' },
      { key: 'unplanned', label: 'No planificadas', minutes: totalDowntime, detail: 'Paradas imprevistas registradas', box: 'border-rose-200 bg-rose-50', title: 'text-rose-800', value: 'text-rose-700', detailColor: 'text-rose-600' },
      { key: 'speed', label: 'Velocidad de equipo', minutes: speedLossMinutes, detail: 'Equivalente de capacidad no producida', box: 'border-purple-200 bg-purple-50', title: 'text-purple-800', value: 'text-purple-700', detailColor: 'text-purple-600' },
      { key: 'quality', label: 'Calidad', minutes: qualityLossMinutes, detail: `${Math.max(0, totalProduction-goodProduction).toLocaleString()} und ÷ velocidad registrada`, box: 'border-amber-200 bg-amber-50', title: 'text-amber-800', value: 'text-amber-700', detailColor: 'text-amber-600' }
    ].sort((first, second) => second.minutes - first.minutes);
    const availabilityRate = plannedMinutes ? operatingMinutes / plannedMinutes : 0;
    const performanceRate = theoreticalProduction ? totalProduction / theoreticalProduction : 0;
    const qualityRate = totalProduction ? goodProduction / totalProduction : 0;
    const leanOee = availabilityRate * performanceRate * qualityRate;
    const weightedOeeBase = sourceRecords.reduce((sum, record) => sum + Number(record.metrics?.plannedTimeMin || 0), 0);
    const consolidatedOee = weightedOeeBase > 0
      ? sourceRecords.reduce((sum, record) => sum + Number(record.metrics?.oee || 0) * Number(record.metrics?.plannedTimeMin || 0), 0) / weightedOeeBase
      : Math.max(0, Math.min(100, leanOee * 100));
    const boundedPercent = value => Math.max(0, Math.min(100, value * 100));
    const equipmentSpeedPercent = Math.max(0, performanceRate * 100);
    const productionDifference = totalProduction - theoreticalProduction;
    const machineSummary = sourceRecords.reduce((summary, record) => {
      const machine = record.machine || 'Sin máquina';
      if (!summary[machine]) summary[machine] = { machine, orders: 0, downtime: 0, oeeTotal: 0 };
      summary[machine].orders += 1;
      summary[machine].oeeTotal += Number(record.metrics?.oee || 0);
      summary[machine].downtime += (record.losses || []).filter(loss => loss.category === 'availability').reduce((sum, loss) => sum + Number(loss.duration || 0), 0);
      return summary;
    }, {});
    const machineOverviewData = Object.values(machineSummary).map((item: any) => ({ ...item, oee: item.orders ? item.oeeTotal / item.orders : 0 }));
    const orderStatusOverview = Object.entries(WORK_ORDER_STATUS).map(([status, config]) => ({ name: config.label, value: workOrders.filter(order => order.status === status).length })).filter(item => item.value > 0);

    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <div className="overflow-hidden rounded-2xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-700 p-7 text-white shadow-xl"><div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-200">Centro de control · BIOEE B</p><h2 className="mt-3 text-4xl font-bold">Dashboard</h2><p className="mt-2 text-blue-100">Producción, eficiencia, pérdidas y control de sobrepeso.</p></div><div className="grid gap-3 sm:grid-cols-2"><div><label className="mb-1 block text-xs font-semibold text-blue-100">Lote</label><select className="min-w-56 rounded-lg border border-white/20 bg-white p-2.5 text-slate-900" value={dashboardLot} onChange={(event) => { setDashboardLot(event.target.value); setDashboardOrder(''); }}><option value="">Todos los lotes</option>{dashboardLots.map(lot => <option key={lot}>{lot}</option>)}</select></div><div><label className="mb-1 block text-xs font-semibold text-blue-100">Orden de trabajo</label><select disabled={!dashboardLot} className="min-w-56 rounded-lg border border-white/20 bg-white p-2.5 text-slate-900 disabled:bg-slate-200 disabled:text-slate-500" value={dashboardOrder} onChange={(event) => setDashboardOrder(event.target.value)}><option value="">{dashboardLot ? 'Todas las OT' : 'Selecciona un lote'}</option>{dashboardOrders.map(order => <option key={order}>{order}</option>)}</select></div></div></div></div>
        {allSourceRecords.length === 0 ? <Card className="p-12 text-center"><Activity className="mx-auto mb-3 text-slate-300" size={48}/><h3 className="font-bold text-slate-700">Aún no hay datos productivos</h3><p className="mt-1 text-slate-500">Carga una plantilla de OT y registra una OEE para alimentar este dashboard.</p></Card> : sourceRecords.length === 0 ? <Card className="p-12 text-center"><Search className="mx-auto mb-3 text-slate-300" size={44}/><h3 className="font-bold text-slate-700">Sin datos para esta selección</h3><p className="mt-1 text-slate-500">Selecciona otro lote u orden de trabajo.</p></Card> : <>
          <Card className="p-6"><div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Descomposición Lean</p><h3 className="mt-1 text-xl font-bold text-slate-900">Cómo se construye el OEE</h3><p className="text-sm text-slate-500">Del tiempo programado hasta las unidades buenas a la primera.</p></div><div className="rounded-xl bg-slate-950 px-5 py-3 text-white"><p className="text-xs uppercase tracking-wider text-slate-400">OEE consolidado</p><p className="text-3xl font-bold">{consolidatedOee.toFixed(2)}%</p><p className="mt-1 text-[10px] text-slate-400">Ponderado por tiempo programado</p></div></div><div className="space-y-4">
            <div className="grid gap-2 md:grid-cols-[180px_1fr_130px] md:items-center"><div><p className="font-bold text-slate-800">Tiempo programado</p><p className="text-xs text-slate-500">Turno menos detenciones planificadas</p></div><div className="h-12 overflow-hidden rounded-lg bg-slate-100"><div className="flex h-full w-full items-center justify-center bg-amber-300 px-3 text-sm font-bold text-amber-950">{(plannedMinutes/60).toFixed(2)} horas</div></div><div className="text-right"><p className="text-sm font-semibold text-slate-600">100%</p><p className="text-xs text-slate-500">Excluido: {totalPlannedExclusions.toFixed(2)} min</p></div></div>
            <div className="grid gap-2 md:grid-cols-[180px_1fr_130px] md:items-center"><div><p className="font-bold text-slate-800">Disponibilidad</p><p className="text-xs text-slate-500">Tiempo productivo</p></div><div className="flex h-12 overflow-hidden rounded-lg bg-slate-100"><div className="flex items-center justify-center bg-cyan-500 px-2 text-sm font-bold text-white" style={{width:`${boundedPercent(availabilityRate)}%`}}>{operatingMinutes ? `${(operatingMinutes/60).toFixed(2)} h` : ''}</div><div className="flex flex-1 items-center justify-center bg-rose-500 px-2 text-xs font-semibold text-white">Pérdida {totalDowntime.toFixed(0)} min</div></div><div className="text-right"><p className="font-bold text-cyan-700">{boundedPercent(availabilityRate).toFixed(2)}%</p><p className="text-xs text-slate-500">Productivo / Programado</p></div></div>
            <div className="grid gap-2 md:grid-cols-[180px_1fr_150px] md:items-center"><div><p className="font-bold text-slate-800">Velocidad de equipo</p><p className="text-xs text-slate-500">Real ÷ capacidad teórica</p></div><div><div className="flex h-12 overflow-hidden rounded-lg bg-slate-100"><div className="flex items-center justify-center bg-orange-400 px-2 text-sm font-bold text-orange-950" style={{width:`${boundedPercent(performanceRate)}%`}}>{totalProduction.toLocaleString()} und reales</div><div className={`flex flex-1 items-center justify-center px-2 text-xs font-semibold text-white ${productionDifference >= 0 ? 'bg-emerald-600' : 'bg-rose-500'}`}>{productionDifference >= 0 ? `Sobre capacidad +${productionDifference.toLocaleString()} und` : `Pérdida ${Math.abs(productionDifference).toLocaleString()} und`}</div></div><p className="mt-1 text-xs text-slate-500">Capacidad teórica: {theoreticalProduction.toLocaleString()} und = tiempo operativo × velocidad registrada</p></div><div className="text-right"><p className="font-bold text-orange-600">{equipmentSpeedPercent.toFixed(2)}%</p><p className="text-xs text-slate-500">{totalProduction.toLocaleString()} ÷ {theoreticalProduction.toLocaleString()}</p></div></div>
            <div className="grid gap-2 md:grid-cols-[180px_1fr_130px] md:items-center"><div><p className="font-bold text-slate-800">Calidad</p><p className="text-xs text-slate-500">Buenas a la primera</p></div><div className="flex h-12 overflow-hidden rounded-lg bg-slate-100"><div className="flex items-center justify-center bg-lime-500 px-2 text-sm font-bold text-lime-950" style={{width:`${boundedPercent(qualityRate)}%`}}>{goodProduction.toLocaleString()} buenas</div><div className="flex flex-1 items-center justify-center bg-rose-500 px-2 text-xs font-semibold text-white">Rechazos {Math.max(0,totalProduction-goodProduction).toLocaleString()}</div></div><div className="text-right"><p className="font-bold text-lime-700">{boundedPercent(qualityRate).toFixed(2)}%</p><p className="text-xs text-slate-500">Buenas / Total</p></div></div>
          </div></Card>
          <Card className="p-6"><div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="font-bold text-slate-800">Evolución del OEE global</h3><p className="text-sm text-slate-500">Un único gráfico para consultar el consolidado mensual, semanal o diario.</p></div><div><label className="mb-1 block text-xs font-semibold text-slate-500">Nivel de consolidación</label><select className="min-w-52 rounded-lg border border-slate-300 bg-white p-2" value={dashboardOeePeriod} onChange={(event) => setDashboardOeePeriod(event.target.value)}><option value="month">Mensual</option><option value="week">Semanal</option><option value="day">Diario</option></select></div></div><div className="h-72"><ResponsiveContainer><LineChart data={temporalOeeData}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="period" tick={{fontSize:11}}/><YAxis domain={[0,100]} unit="%"/><RechartsTooltip formatter={(value) => [`${Number(value).toFixed(2)}%`, 'OEE global']}/><Line type="monotone" dataKey="oee" name="OEE global" stroke={COLORS.primary} strokeWidth={3} dot={{r:5}} activeDot={{r:7}}/></LineChart></ResponsiveContainer></div></Card>
          <Card className="p-6"><h3 className="font-bold text-slate-800">Árbol de pérdidas</h3><p className="mb-5 text-sm text-slate-500">Pérdidas equivalentes en minutos, ordenadas automáticamente de mayor a menor.</p><div className="flex flex-col items-center"><div className="rounded-xl bg-slate-900 px-6 py-3 text-center text-white"><p className="text-xs text-slate-300">Tiempo total del proceso</p><p className="text-xl font-bold">{totalShiftMinutes.toFixed(0)} min</p></div><div className="h-6 w-px bg-slate-300"/><div className="grid w-full gap-4 md:grid-cols-4">{lossTreeItems.map((item, index) => <div key={item.key} className={`rounded-xl border p-4 text-center ${item.box}`}><p className={`text-xs font-bold uppercase tracking-wide ${item.title}`}>#{index + 1} · {item.label}</p><p className={`text-2xl font-bold ${item.value}`}>{item.minutes.toFixed(2)} min</p><p className={`text-xs ${item.detailColor}`}>{item.detail}</p></div>)}</div></div></Card>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card className="p-6"><h3 className="mb-1 font-bold text-slate-800">Pareto de pérdidas de disponibilidad</h3><p className="mb-5 text-sm text-slate-500">Causas ordenadas de mayor a menor y porcentaje acumulado.</p>{paretoData.length ? <div className="h-72"><ResponsiveContainer><ComposedChart data={paretoData}><CartesianGrid strokeDasharray="3 3" vertical={true}/><XAxis dataKey="cause" tick={{fontSize:10}} interval={0}/><YAxis yAxisId="minutes"/><YAxis yAxisId="percent" orientation="right" domain={[0,100]} unit="%"/><RechartsTooltip/><Legend/><Bar yAxisId="minutes" dataKey="minutes" name="Minutos" fill={COLORS.critical} radius={[5,5,0,0]}/><Line yAxisId="percent" type="monotone" dataKey="cumulative" name="% acumulado" stroke={COLORS.primary} strokeWidth={3}/></ComposedChart></ResponsiveContainer></div> : <p className="py-16 text-center text-slate-500">Sin pérdidas registradas.</p>}</Card>
            <Card className="p-6"><div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="font-bold text-slate-800">Control de sobrepeso</h3><p className="text-sm text-slate-500">Vista ampliada del objetivo y sus límites de tolerancia ± 0.5 g.</p></div><div><label className="mb-1 block text-xs font-semibold text-slate-500">Producto</label><select className="min-w-56 rounded-lg border border-slate-300 bg-white p-2" value={dashboardOverweightProduct} onChange={(event) => setDashboardOverweightProduct(event.target.value)}><option value="" disabled>Selecciona producto</option>{products.map(product => <option key={product}>{product}</option>)}</select></div></div>{overweightData.length ? <><div className="mb-3 flex flex-wrap gap-2 text-xs font-semibold"><span className="rounded-full bg-rose-50 px-3 py-1 text-rose-700">Límite inferior: {lowerWeightTolerance.toFixed(2)} g</span><span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">Objetivo: {centralWeight.toFixed(2)} g</span><span className="rounded-full bg-rose-50 px-3 py-1 text-rose-700">Límite superior: {upperWeightTolerance.toFixed(2)} g</span><span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">Verde: conforme</span><span className="rounded-full bg-rose-50 px-3 py-1 text-rose-700">Rojo: fuera de tolerancia</span></div><div className="h-80"><ResponsiveContainer><ScatterChart margin={{top:18,right:32,bottom:8,left:8}}><CartesianGrid/><XAxis type="category" dataKey="time" name="Hora"/><YAxis type="number" dataKey="weight" name="Peso" unit=" g" domain={weightZoomDomain} allowDataOverflow tickCount={9}/><RechartsTooltip cursor={{strokeDasharray:'3 3'}}/><ReferenceLine y={upperWeightTolerance} stroke={COLORS.critical} strokeWidth={2} strokeDasharray="6 4" label={{value:'+0.5 g',position:'insideTopRight',fill:COLORS.critical}}/><ReferenceLine y={centralWeight} stroke={COLORS.primary} strokeWidth={3} label={{value:'Objetivo',position:'insideTopRight',fill:COLORS.primary}}/><ReferenceLine y={lowerWeightTolerance} stroke={COLORS.critical} strokeWidth={2} strokeDasharray="6 4" label={{value:'-0.5 g',position:'insideBottomRight',fill:COLORS.critical}}/><Scatter data={overweightData}>{overweightData.map((item, index) => <Cell key={`${item.time}-${index}`} fill={item.weight >= lowerWeightTolerance && item.weight <= upperWeightTolerance ? '#10b981' : '#ef4444'}/>)}</Scatter></ScatterChart></ResponsiveContainer></div>{weightsOutsideZoom > 0 && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{weightsOutsideZoom} medición(es) extrema(s) quedan fuera de esta vista ampliada. Sus valores siguen almacenados.</p>}</> : <p className="py-16 text-center text-slate-500">{dashboardOverweightProduct ? 'Sin pesos registrados para el producto.' : 'Selecciona un producto para ver los datos.'}</p>}</Card>
          </div>
        </>}
      </div>
    );
  };

  const WorkOrdersView = () => {
    const activeStatuses = ['not_started', 'in_progress'];
    const normalized = (value) => String(value || '').toLowerCase();
    const visibleWorkOrders = workOrders.filter((order) => {
      if (!activeStatuses.includes(order.status)) return false;
      const assignedMachines = productionLineOperators.find(operator => operator.id === currentUser?.id)?.machines || currentUser?.machines || [];
      const operatorHasAccess = role === 'supervisor' || assignedMachines.includes('*') || assignedMachines.some(machine => normalized(`${order.machine} ${order.line}`).includes(normalized(machine)));
      if (!operatorHasAccess) return false;
      return normalized(order.id).includes(normalized(workOrderFilters.code))
        && normalized(order.lot).includes(normalized(workOrderFilters.lot))
        && normalized(order.product).includes(normalized(workOrderFilters.product))
        && normalized(`${order.line} ${order.machine}`).includes(normalized(workOrderFilters.line))
        && String(order.plannedQty).includes(workOrderFilters.quantity.replace(/[^0-9]/g, ''))
        && (!workOrderFilters.status || order.status === workOrderFilters.status)
        && normalized(order.registrar || 'Sin registrador').includes(normalized(workOrderFilters.registrar));
    });
    const updateFilter = (field, value) => setWorkOrderFilters(current => ({ ...current, [field]: value }));

    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Órdenes de Trabajo</h2>
            <p className="text-slate-500">{role === 'supervisor' ? 'Carga y consulta las OT por lote, línea y registrador.' : 'Se muestran las OT disponibles para tu línea de producción.'}</p>
          </div>
          <div className="flex items-center gap-3">
            {role === 'supervisor' && (
              <>
                <input ref={workOrdersFileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleWorkOrdersImport} />
                <Button variant="secondary" className="!py-2" onClick={downloadWorkOrderTemplate}><Download size={18} /> Descargar plantilla</Button>
                <Button variant="primary" className="!py-2" onClick={() => workOrdersFileInputRef.current?.click()}><Upload size={18} /> Cargar Excel</Button>
              </>
            )}
            <Button variant="secondary" className="!py-2"><Search size={18} /> Buscar</Button>
          </div>
        </div>

        {importMessage && <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{importMessage}</div>}

        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-sm text-slate-600">
                  <th className="p-4 font-semibold">Lote</th><th className="p-4 font-semibold">Código OT</th><th className="p-4 font-semibold">Producto</th><th className="p-4 font-semibold">Línea/Máquina</th><th className="p-4 font-semibold">Planificado</th><th className="p-4 font-semibold">Estado</th><th className="p-4 font-semibold">Registrador / Acción</th>
                </tr>
                  <tr className="border-b border-slate-200 bg-white">
                    <th className="p-2"><input className="w-full rounded border border-slate-300 p-2 text-xs" placeholder="Filtrar lote" value={workOrderFilters.lot} onChange={(e) => updateFilter('lot', e.target.value)} /></th>
                    <th className="p-2"><input className="w-full rounded border border-slate-300 p-2 text-xs" placeholder="Filtrar código" value={workOrderFilters.code} onChange={(e) => updateFilter('code', e.target.value)} /></th>
                    <th className="p-2"><input className="w-full rounded border border-slate-300 p-2 text-xs" placeholder="Filtrar producto" value={workOrderFilters.product} onChange={(e) => updateFilter('product', e.target.value)} /></th>
                    <th className="p-2"><input className="w-full rounded border border-slate-300 p-2 text-xs" placeholder="Filtrar línea o máquina" value={workOrderFilters.line} onChange={(e) => updateFilter('line', e.target.value)} /></th>
                    <th className="p-2"><input className="w-full rounded border border-slate-300 p-2 text-xs" placeholder="Filtrar cantidad" value={workOrderFilters.quantity} onChange={(e) => updateFilter('quantity', e.target.value)} /></th>
                    <th className="p-2"><select className="w-full rounded border border-slate-300 p-2 text-xs" value={workOrderFilters.status} onChange={(e) => updateFilter('status', e.target.value)}><option value="">Todos</option>{activeStatuses.map(status => <option key={status} value={status}>{WORK_ORDER_STATUS[status].label}</option>)}</select></th>
                    <th className="p-2"><select className="w-full rounded border border-slate-300 p-2 text-xs" value={workOrderFilters.registrar} onChange={(e) => updateFilter('registrar', e.target.value)}><option value="">Todos</option><option value="Sin registrador">Sin registrador</option>{productionLineOperators.map(operator => <option key={operator.id} value={operator.name}>{operator.name}</option>)}</select></th>
                  </tr>
              </thead>
              <tbody>
                {visibleWorkOrders.map((ot) => (
                  <tr key={ot.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="p-4 font-semibold text-blue-700">{ot.lot}</td><td className="p-4 font-medium text-slate-800">{ot.id}</td><td className="p-4 text-slate-600">{ot.product}</td>
                    <td className="p-4"><div className="text-sm text-slate-800">{ot.line}</div><div className="text-xs text-slate-500">{ot.machine}</div></td>
                    <td className="p-4 text-slate-600">{ot.plannedQty.toLocaleString()} und</td>
                    <td className="p-4"><Badge variant={WORK_ORDER_STATUS[ot.status].variant}>{WORK_ORDER_STATUS[ot.status].label}</Badge></td>
                    <td className="p-4">
                      {role === 'supervisor' ? (
                        <div className="flex min-w-48 items-center gap-2"><span className="flex-1 text-sm font-medium text-slate-700">{ot.registrar || 'Sin registrador'}</span>{ot.status === 'in_progress' && <button title="Ver OEE en tiempo real" onClick={() => setSelectedLiveOrder(activeSession?.id === ot.id ? activeSession : ot)} className="rounded-lg border border-blue-200 p-2 text-blue-600 hover:bg-blue-50"><Eye size={18}/></button>}</div>
                      ) : (
                         <Button variant="primary" className="!px-4 !py-2 text-sm" disabled={ot.status === 'in_progress' && ot.registrar !== currentUser.name} onClick={() => {
                           setActiveSession(current => current?.id === ot.id ? current : {...ot, operator: currentUser.name, registrar: currentUser.name, shift: SHIFTS[0], realQty: 0, goodQty: 0, rejectQty: 0, reprocessQty: 0, wasteQty: 0, machineSpeed: 0, productionRegistered: false, losses: [], supportPersonnelCount: 0, overweights: ot.overweights || [], materialDiscards: ot.materialDiscards || [], targetWeight: ot.targetWeight || '', processStart: '00:00', processEnd: '00:00', performanceEndTime: ''});
                          setWorkOrders(current => current.map(order => order.id === ot.id ? { ...order, status: 'in_progress', registrar: currentUser.name } : order));
                          setCurrentView('active_production');
                        }}>{ot.status === 'in_progress' ? 'Continuar registro' : 'Registrar detenciones'} <ArrowRight size={16} /></Button>
                      )}
                    </td>
                  </tr>
                ))}
                {visibleWorkOrders.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-slate-500">No hay OT disponibles para los filtros o tu línea de producción.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
        <Modal isOpen={Boolean(selectedLiveOrder)} onClose={() => setSelectedLiveOrder(null)} title="Detenciones en tiempo real"><RecordDetails record={selectedLiveOrder} metrics={selectedLiveOrder ? calculateSessionMetrics(selectedLiveOrder) : null} readOnly /></Modal>
      </div>
    );
  };

  const ActiveProductionView = () => {
    const [lossModalOpen, setLossModalOpen] = useState(false);
    const [lossType, setLossType] = useState('availability'); // availability, performance, quality
    const [lossForm, setLossForm] = useState({ cause: '', durationHours: '0', durationMinutes: '0', goodQty: '', reprocessQty: '', wasteQty: '', machineSpeed: '', supportCount: '0', comment: '' });
    const [editingLossId, setEditingLossId] = useState(null);
    
    const [ticketModalOpen, setTicketModalOpen] = useState(false);
    const [maintenanceTicket, setMaintenanceTicket] = useState(null);
    const [ticketForm, setTicketForm] = useState({ priority: 'Media', detail: '', reportedBy: DUMMY_USER.name });
    const [supportModalOpen, setSupportModalOpen] = useState(false);
    const [supportCountDraft, setSupportCountDraft] = useState('0');
    const [overweightModalOpen, setOverweightModalOpen] = useState(false);
    const [overweightDraft, setOverweightDraft] = useState([{ sampleSize: '', weights: [''], time: '', measuredBy: 'PD' }]);
    const [targetWeight, setTargetWeight] = useState('');
    const [materialModalOpen, setMaterialModalOpen] = useState(false);
    const [materialForm, setMaterialForm] = useState({ type: 'Envasado', reason: '', code: '', description: '', quantity: '', unit: 'unidades' });

    if (!activeSession) return <div>No hay sesión activa.</div>;

    const metrics = calculateSessionMetrics(activeSession);
    const downtimeMetrics = calculateDowntimeMetrics(activeSession);
    const mandatoryReady = Boolean(activeSession.processStart && activeSession.processEnd && activeSession.productionRegistered);
    const productionRealPreview = Math.max(0, Math.round(
      (Number(lossForm.machineSpeed) || 0) * Math.max(0,
        elapsedMinutes(activeSession.processStart, activeSession.processEnd) -
        activeSession.losses
          .filter(loss => loss.category === 'planned_availability' || loss.category === 'availability')
          .reduce((sum, loss) => sum + Number(loss.duration || 0), 0)
      )
    ));
    const requiresMaintenanceTicket = lossForm.cause === 'Avería mecánica' || lossForm.cause === 'Avería eléctrica';
    const updateProcessTime = (field, value) => {
      setActiveSession(current => current ? { ...current, [field]: value } : current);
    };

    const openSupportModal = () => {
      setSupportCountDraft(String(activeSession.supportPersonnelCount || 0));
      setSupportModalOpen(true);
    };

    const normalizeLosses = (session, losses) => {
      const normalizedLosses = losses.map(loss => loss.category === 'performance'
        ? { ...loss, duration: 0, speed: null, speedEndTime: null }
        : loss);
      const qualityLosses = normalizedLosses.filter(loss => loss.category === 'quality');
      const reprocessQty = qualityLosses.reduce((sum, loss) => sum + Number(loss.reprocessQty || 0), 0);
      const wasteQty = qualityLosses.reduce((sum, loss) => sum + Number(loss.wasteQty || 0), 0);
      const rejectQty = reprocessQty + wasteQty;
      const totalDowntime = normalizedLosses
        .filter(loss => loss.category === 'planned_availability' || loss.category === 'availability')
        .reduce((sum, loss) => sum + Number(loss.duration || 0), 0);
      const calculatedRealQty = session.productionRegistered && Number(session.machineSpeed) > 0
        ? Math.max(0, Math.round(Number(session.machineSpeed) * Math.max(0, elapsedMinutes(session.processStart, session.processEnd) - totalDowntime)))
        : Math.max(0, Number(session.realQty || 0));
      const registeredGoodQty = qualityLosses.length
        ? qualityLosses.reduce((sum, loss) => sum + Number(loss.goodQty || 0), 0)
        : Math.max(0, calculatedRealQty - rejectQty);
      return {
        ...session,
        losses: normalizedLosses,
        performanceEndTime: '',
        reprocessQty,
        wasteQty,
        rejectQty,
        realQty: calculatedRealQty,
        goodQty: registeredGoodQty
      };
    };

    const resetLossEditor = () => {
      setEditingLossId(null);
      setLossForm({ cause: '', durationHours: '0', durationMinutes: '0', goodQty: '', reprocessQty: '', wasteQty: '', machineSpeed: '', supportCount: '0', comment: '' });
      setMaintenanceTicket(null);
      setTicketForm({ priority: 'Media', detail: '', reportedBy: DUMMY_USER.name });
    };

    const openNewLoss = (category) => {
      resetLossEditor();
      setLossType(category);
      setLossModalOpen(true);
    };

    const openEditLoss = (loss) => {
      setEditingLossId(loss.id);
      setLossType(loss.category);
      setLossForm({
        cause: loss.cause || '', durationHours: String(Math.floor(Number(loss.duration || 0) / 60)), durationMinutes: String(Number(loss.duration || 0) % 60), goodQty: String(loss.goodQty ?? activeSession.goodQty ?? ''),
        reprocessQty: String(loss.reprocessQty || ''), wasteQty: String(loss.wasteQty || ''),
        machineSpeed: String(loss.machineSpeed ?? activeSession.machineSpeed ?? ''), supportCount: String(loss.supportPersonnelCount || 0), comment: loss.comment || ''
      });
      setMaintenanceTicket(loss.ticket || null);
      setLossModalOpen(true);
    };

    const deleteLoss = (loss) => {
      if (!window.confirm(`¿Eliminar el evento "${loss.cause}"? Esta acción actualizará los indicadores.`)) return;
      setActiveSession(current => normalizeLosses(current, current.losses.filter(item => item.id !== loss.id)));
    };

    const saveSupportOperators = () => {
      setActiveSession(current => ({ ...current, supportPersonnelCount: Math.max(0, Number(supportCountDraft) || 0) }));
      setSupportModalOpen(false);
    };

    const handleCreateMaintenanceTicket = () => {
      const date = new Date();
      const ticketCode = `MT-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-${String(Date.now()).slice(-5)}`;
      setMaintenanceTicket({
        code: ticketCode,
        equipment: activeSession.machine,
        cause: lossType === 'quality' ? 'Producción real' : lossForm.cause,
        ...ticketForm,
        createdAt: date.toLocaleTimeString()
      });
      setTicketModalOpen(false);
    };

    const handleAddLoss = () => {
      const selectedDuration = (Number(lossForm.durationHours) || 0) * 60 + (Number(lossForm.durationMinutes) || 0);
      const newLoss = {
        id: Date.now(),
        category: lossType,
        cause: lossForm.cause,
        duration: lossType === 'performance' || lossType === 'quality' ? 0 : selectedDuration,
        qty: lossType === 'quality' ? (parseInt(lossForm.reprocessQty) || 0) + (parseInt(lossForm.wasteQty) || 0) : 0,
        goodQty: lossType === 'quality' ? parseInt(lossForm.goodQty) || 0 : null,
        reprocessQty: lossType === 'quality' ? parseInt(lossForm.reprocessQty) || 0 : 0,
        wasteQty: lossType === 'quality' ? parseInt(lossForm.wasteQty) || 0 : 0,
        machineSpeed: lossType === 'quality' ? Number(lossForm.machineSpeed) || 0 : null,
        supportPersonnelCount: lossType === 'planned_availability' ? Number(lossForm.supportCount) || 0 : 0,
        comment: lossForm.comment,
        speed: null,
        speedEndTime: null,
        ticketCode: requiresMaintenanceTicket ? maintenanceTicket?.code : null,
        ticket: requiresMaintenanceTicket ? maintenanceTicket : null,
        time: new Date().toLocaleTimeString()
      };
      
      const nextLosses = editingLossId
        ? activeSession.losses.map(loss => loss.id === editingLossId ? { ...newLoss, id: editingLossId, time: loss.time } : loss)
        : [...activeSession.losses, newLoss];
      const nextSession = lossType === 'quality'
        ? { ...activeSession, realQty: productionRealPreview, machineSpeed: Number(newLoss.machineSpeed) || 0, productionRegistered: true }
        : activeSession;
      setActiveSession(normalizeLosses(nextSession, nextLosses));
      
      setLossModalOpen(false);
      resetLossEditor();
    };

    const updateSampleSize = (sampleIndex, value) => {
      const sampleSize = Math.max(0, Math.min(100, parseInt(value) || 0));
      setOverweightDraft(current => current.map((sample, index) => index === sampleIndex ? {
        ...sample,
        sampleSize: value,
        weights: Array.from({ length: sampleSize }, (_, weightIndex) => sample.weights[weightIndex] || '')
      } : sample));
    };

    const updateSampleWeight = (sampleIndex, weightIndex, value) => {
      setOverweightDraft(current => current.map((sample, index) => index === sampleIndex ? {
        ...sample,
        weights: sample.weights.map((weight, index) => index === weightIndex ? value : weight)
      } : sample));
    };

    const defaultOverweightTime = (sampleIndex) => {
      const existingSamples = new Set((activeSession.overweights || []).map(item => item.sampleId)).size;
      return addMinutesToTime(activeSession.processStart || '00:00', (existingSamples + sampleIndex + 1) * 30);
    };

    const openOverweightModal = () => {
      setTargetWeight(String(activeSession.targetWeight || ''));
      setOverweightDraft([{ sampleSize: '', weights: [''], time: defaultOverweightTime(0), measuredBy: 'PD' }]);
      setOverweightModalOpen(true);
    };

    const addOverweightSample = () => {
      setOverweightDraft(current => [...current, { sampleSize: '', weights: [''], time: defaultOverweightTime(current.length), measuredBy: 'PD' }]);
    };

    const updateSampleTime = (sampleIndex, value) => {
      setOverweightDraft(current => current.map((sample, index) => index === sampleIndex ? { ...sample, time: value } : sample));
    };

    const updateSampleMeasuredBy = (sampleIndex, value) => {
      setOverweightDraft(current => current.map((sample, index) => index === sampleIndex ? { ...sample, measuredBy: value } : sample));
    };

    const validOverweightSamples = overweightDraft.length > 0 && overweightDraft.every(sample => sample.time && Number(sample.sampleSize) > 0 && sample.weights.length === Number(sample.sampleSize) && sample.weights.every(weight => Number(weight) > 0));

    const saveOverweights = () => {
      if (!validOverweightSamples) return;
      const validRows = overweightDraft.flatMap((sample, sampleIndex) => sample.weights.map((weight, weightIndex) => ({ id: Date.now() + Math.random(), sampleId: `M-${Date.now()}-${sampleIndex + 1}`, sampleSize: Number(sample.sampleSize), measurement: weightIndex + 1, weight: Number(weight), quantity: 1, time: sample.time, measuredBy: sample.measuredBy })));
      if (!validRows.length) return;
      setActiveSession(current => ({ ...current, targetWeight: Number(targetWeight) || current.targetWeight, overweights: [...(current.overweights || []), ...validRows] }));
      setOverweightDraft([{ sampleSize: '', weights: [''], time: '', measuredBy: 'PD' }]);
      setOverweightModalOpen(false);
    };

    const saveMaterialDiscard = () => {
      if (!materialForm.reason.trim() || !materialForm.code.trim() || !materialForm.description || Number(materialForm.quantity) <= 0) return;
      setActiveSession(current => ({ ...current, materialDiscards: [...(current.materialDiscards || []), { ...materialForm, id: Date.now(), quantity: Number(materialForm.quantity), date: new Date().toISOString().slice(0, 10) }] }));
      setMaterialForm({ type: 'Envasado', reason: '', code: '', description: '', quantity: '', unit: 'unidades' });
      setMaterialModalOpen(false);
    };

    const updateDiscardCode = (code) => {
      const material = MATERIAL_PRODUCTS.find(item => item.code.toLowerCase() === code.trim().toLowerCase());
      setMaterialForm(current => ({ ...current, code, description: material?.description || '', unit: material?.unit || '' }));
    };

    const handleFinish = () => {
      const linkedOrder = workOrders.find(order => order.id === activeSession.id);
      const mergeById = (sessionItems = [], orderItems = []) => Array.from(new Map([...sessionItems, ...orderItems].map(item => [item.id, item])).values());
      const recordToSave = {
        ...activeSession,
        losses: (activeSession.losses || []).filter(loss => ['availability', 'planned_availability', 'quality'].includes(loss.category)),
        targetWeight: activeSession.targetWeight || linkedOrder?.targetWeight,
        overweights: mergeById(activeSession.overweights, linkedOrder?.overweights),
        materialDiscards: mergeById(activeSession.materialDiscards, linkedOrder?.materialDiscards),
        workOrderId: activeSession.id,
        id: `REC-${Date.now().toString().slice(-6)}`,
        status: 'review',
        metrics: metrics,
        date: new Date().toISOString().split('T')[0]
      };
      setRecords([...records, recordToSave]);
      setWorkOrders(current => current.map(order => order.id === activeSession.id ? { ...order, status: 'review' } : order));
      setActiveSession(null);
      setCurrentView('work_orders');
      // In a real app, show a toast notification here
      alert("Registro enviado a revisión del supervisor.");
    };

    return (
      <div className="space-y-6 animate-in fade-in duration-300 pb-20">
        {/* Header Bar */}
        <div className="bg-slate-900 text-white p-4 rounded-xl shadow-lg flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="bg-blue-600 p-3 rounded-lg"><Play className="fill-current" /></div>
            <div>
              <h2 className="text-xl font-bold">{activeSession.id}</h2>
              <p className="text-slate-400 text-sm">{activeSession.product} | {activeSession.machine}</p>
            </div>
          </div>
          <div className="flex gap-6 text-sm">
            <div className="text-center">
              <p className="text-slate-400">Operador</p>
              <p className="font-semibold">{activeSession.operator}</p>
              <p className="text-xs text-slate-400">{Number(activeSession.supportPersonnelCount || 0)} persona(s) de apoyo</p>
            </div>
            <div className="text-center">
              <div className="flex items-end gap-2"><TimeField label="Inicio del proceso" value={activeSession.processStart} onChange={(value) => updateProcessTime('processStart', value)}/><span className="pb-3 text-slate-400">a</span><TimeField label="Fin del proceso" value={activeSession.processEnd} onChange={(value) => updateProcessTime('processEnd', value)}/></div>
            </div>
            <div className="text-center hidden md:block">
              <p className="text-slate-400">Planificado</p>
              <p className="font-semibold">{activeSession.plannedQty.toLocaleString()} und</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4"><Card className="border-l-4 border-l-blue-500 p-4"><p className="text-sm font-medium text-slate-600">Tiempo de operación</p><h3 className="text-2xl font-bold text-slate-900">{downtimeMetrics.operationMinutes.toFixed(0)} min</h3></Card><Card className="border-l-4 border-l-rose-500 p-4"><p className="text-sm font-medium text-slate-600">Detención acumulada</p><h3 className="text-2xl font-bold text-rose-600">{downtimeMetrics.downtimeMinutes.toFixed(0)} min</h3></Card><Card className="border-l-4 border-l-emerald-500 p-4"><p className="text-sm font-medium text-slate-600">Disponibilidad</p><h3 className="text-2xl font-bold text-emerald-600">{downtimeMetrics.availability.toFixed(2)}%</h3></Card><Card className="border-l-4 border-l-amber-500 p-4"><p className="text-sm font-medium text-slate-600">OEE</p><h3 className="text-2xl font-bold" style={{color: getOEEColor(downtimeMetrics.oee)}}>{downtimeMetrics.oee.toFixed(2)}%</h3></Card></div>

        <div className="mt-8 mb-4 flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-bold text-slate-800">Registros de la OT</h3><p className="text-sm text-slate-500">Registra producción real y los eventos de disponibilidad ocurridos durante el proceso.</p></div><Button variant="secondary" className="!py-2" onClick={openSupportModal}><Users size={18}/> Personal de apoyo ({Number(activeSession.supportPersonnelCount || 0)})</Button></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <button onClick={() => openNewLoss('planned_availability')} className="flex min-h-36 flex-col items-center justify-center rounded-xl border-2 border-sky-200 bg-white p-4 transition-all hover:border-sky-500 hover:shadow-md"><div className="mb-2 rounded-full bg-sky-100 p-3 text-sky-700"><CheckSquare size={24}/></div><span className="font-bold text-slate-800">Detenciones planificadas</span><span className="text-center text-xs text-slate-500">Set up, limpieza y mantenimiento preventivo</span></button>
          <button onClick={() => openNewLoss('availability')} className="flex min-h-36 flex-col items-center justify-center rounded-xl border-2 border-rose-200 bg-white p-4 transition-all hover:border-rose-500 hover:shadow-md"><div className="mb-2 rounded-full bg-rose-100 p-3 text-rose-600"><Pause size={24}/></div><span className="font-bold text-slate-800">Detenciones no planificadas</span><span className="text-center text-xs text-slate-500">Averías, bloqueos, cortes de servicio y otros</span></button>
          <button onClick={() => { const production = activeSession.losses.find(loss => loss.category === 'quality'); production ? openEditLoss(production) : openNewLoss('quality'); }} className="flex min-h-36 flex-col items-center justify-center rounded-xl border-2 border-emerald-200 bg-white p-4 transition-all hover:border-emerald-500 hover:shadow-md"><div className="mb-2 rounded-full bg-emerald-100 p-3 text-emerald-700"><PackageCheck size={24}/></div><span className="font-bold text-slate-800">Producción real</span><span className="text-center text-xs text-slate-500">Unidades buenas, reproceso y desperdicio</span></button>
          <button onClick={openOverweightModal} className="flex min-h-36 flex-col items-center justify-center rounded-xl border-2 border-cyan-200 bg-white p-4 transition-all hover:border-cyan-500 hover:shadow-md"><div className="mb-2 rounded-full bg-cyan-100 p-3 text-cyan-700"><Scale size={24}/></div><span className="font-bold text-slate-800">Registrar sobrepeso</span><span className="text-center text-xs text-slate-500">Muestreos, pesos y hora de medición</span></button>
        </div>
        {/* Recent Events Log */}
        <Card className="mt-8">
          <div className="p-4 border-b border-slate-200">
            <h3 className="font-bold text-slate-800">Eventos Registrados</h3>
          </div>
          <div className="p-0">
            {activeSession.losses.filter(loss => ['availability', 'planned_availability', 'quality'].includes(loss.category)).length === 0 ? (
              <p className="p-6 text-center text-slate-500">No hay eventos ni producción registrados.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {activeSession.losses.filter(loss => ['availability', 'planned_availability', 'quality'].includes(loss.category)).map((loss) => (
                  <li key={loss.id} className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${
                        loss.category === 'planned_availability' ? 'bg-sky-100 text-sky-700' :
                        loss.category === 'availability' ? 'bg-amber-100 text-amber-700' :
                        loss.category === 'performance' ? 'bg-purple-100 text-purple-700' : 'bg-rose-100 text-rose-700'
                      }`}>
                        {loss.category === 'planned_availability' ? <CheckSquare size={18}/> : loss.category === 'availability' ? <Pause size={18}/> : loss.category === 'performance' ? <AlertOctagon size={18}/> : <AlertTriangle size={18}/>}
                      </div>
                      <div>
                        <p className="font-medium text-slate-800">{loss.cause}</p>
                        <p className="text-xs text-slate-500">{loss.time} {loss.comment && `- ${loss.comment}`}</p>
                        {loss.category === 'planned_availability' && Number(loss.supportPersonnelCount || 0) > 0 && <p className="mt-1 text-xs font-medium text-sky-700">Personal de apoyo: {Number(loss.supportPersonnelCount)} persona(s)</p>}
                        {loss.ticketCode && (
                          <p className="mt-1 inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                            <Wrench size={12} /> Ticket: {loss.ticketCode}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                      {loss.category === 'performance' ? <p className="text-sm font-semibold text-purple-700">Registro cualitativo</p> : loss.duration > 0 && <p className="font-bold text-slate-800">{loss.duration} min</p>}
                      {loss.category === 'quality' ? <p className="font-bold text-emerald-700">{Number(loss.goodQty || 0).toLocaleString()} und buenas</p> : loss.qty > 0 && <p className="font-bold text-rose-600">{loss.qty} und</p>}
                      </div>
                      {role === 'responsible_operator' && <div className="flex gap-1"><button title="Editar evento" aria-label={`Editar ${loss.cause}`} onClick={() => openEditLoss(loss)} className="rounded-lg border border-blue-200 p-2 text-blue-600 hover:bg-blue-50"><Edit size={16}/></button><button title="Eliminar evento" aria-label={`Eliminar ${loss.cause}`} onClick={() => deleteLoss(loss)} className="rounded-lg border border-rose-200 p-2 text-rose-600 hover:bg-rose-50"><Trash2 size={16}/></button></div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* Action Bar */}
        <div className="fixed bottom-0 left-0 right-0 md:left-64 bg-white border-t border-slate-200 p-4 flex justify-between items-center z-40">
          <Button variant="ghost">Guardar Borrador</Button>
          <Button variant="primary" disabled={!mandatoryReady} onClick={handleFinish} className="!px-8" title={mandatoryReady ? '' : 'Registra la hora de inicio, fin y producción real'}>
            <CheckCircle size={20} /> Finalizar y Enviar a Revisión
          </Button>
        </div>

        {/* Modals */}
        <Modal isOpen={supportModalOpen} onClose={() => setSupportModalOpen(false)} title="Personal de apoyo">
          <div className="space-y-5">
            <p className="text-sm text-slate-600">Indica únicamente cuántas personas apoyaron durante el proceso.</p>
            <div><label className="mb-1 block text-sm font-semibold text-slate-700">Cantidad de personal de apoyo</label><input type="number" min="0" step="1" value={supportCountDraft} onChange={(event) => setSupportCountDraft(event.target.value)} className="w-full rounded-lg border border-slate-300 p-3 text-lg" placeholder="Ej. 3"/></div>
            <div className="flex gap-3"><Button variant="secondary" className="flex-1" onClick={() => setSupportModalOpen(false)}>Cancelar</Button><Button className="flex-1" disabled={Number(supportCountDraft) < 0} onClick={saveSupportOperators}>Guardar cantidad</Button></div>
          </div>
        </Modal>

        <Modal isOpen={lossModalOpen} onClose={() => { setLossModalOpen(false); resetLossEditor(); }} title={`${editingLossId ? 'Editar' : 'Registrar'} ${lossType === 'planned_availability' ? 'Detención planificada - Disponibilidad' : lossType === 'availability' ? 'Detención no planificada - Disponibilidad' : lossType === 'performance' ? 'observación de velocidad de equipo' : 'producción real'}`}>
          <div className="space-y-4">
            {lossType !== 'quality' && <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{lossType === 'performance' ? 'Motivo' : 'Causa'}</label>
              <select 
                className="w-full border-slate-300 rounded-lg shadow-sm p-3 border focus:border-blue-500 focus:ring-blue-500"
                value={lossForm.cause} onChange={(e) => {
                  setLossForm({...lossForm, cause: e.target.value});
                  setMaintenanceTicket(null);
                }}
              >
                <option value="">{lossType === 'performance' ? 'Seleccione un motivo...' : 'Seleccione una causa...'}</option>
                {lossCauses[lossType].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>}
            
            {lossType === 'performance' && (
              <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 text-sm text-purple-900">
                <p className="font-semibold">Registro cualitativo del proceso</p>
                <p className="mt-1 text-purple-700">El rendimiento se calcula automáticamente con la producción, el tiempo operativo y la velocidad de máquina registrada en Producción real.</p>
              </div>
            )}

            {(lossType === 'availability' || lossType === 'planned_availability') && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Duración de la detención</label>
                <div className="grid grid-cols-2 gap-3"><div><label className="mb-1 block text-xs font-semibold text-slate-500">Horas</label><select className="w-full rounded-lg border border-slate-300 bg-white p-3" value={lossForm.durationHours} onChange={(e) => setLossForm({...lossForm, durationHours: e.target.value})}>{Array.from({length: 25}, (_, hour) => <option key={hour} value={hour}>{hour} h</option>)}</select></div><div><label className="mb-1 block text-xs font-semibold text-slate-500">Minutos</label><select className="w-full rounded-lg border border-slate-300 bg-white p-3" value={lossForm.durationMinutes} onChange={(e) => setLossForm({...lossForm, durationMinutes: e.target.value})}>{Array.from({length: 60}, (_, minute) => <option key={minute} value={minute}>{minute} min</option>)}</select></div></div>
              </div>
            )}

            {lossType === 'planned_availability' && (
              <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
                <label className="font-semibold text-sky-900">Cantidad de personal que apoyó en la detención</label>
                <input type="number" min="0" step="1" value={lossForm.supportCount} onChange={(event) => setLossForm({...lossForm, supportCount:event.target.value})} className="mt-2 w-full rounded-lg border border-sky-200 bg-white p-3" placeholder="Ej. 2"/>
              </div>
            )}

            {lossType === 'quality' && (
              <div className="space-y-4">
                <div><label className="block text-sm font-semibold text-slate-800 mb-1">Velocidad de máquina (und/min)</label><input type="number" min="0.01" step="0.01" className="w-full rounded-lg border border-purple-300 p-3 text-lg font-semibold" value={lossForm.machineSpeed} onChange={(e) => setLossForm({...lossForm, machineSpeed: e.target.value})} placeholder="Ingresa la velocidad registrada"/></div>
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4"><p className="text-sm font-semibold text-blue-900">Producción real calculada</p><p className="mt-1 text-3xl font-bold text-blue-700">{productionRealPreview.toLocaleString()} und</p><p className="mt-1 text-xs text-blue-700">Velocidad × (tiempo entre inicio y fin − detenciones planificadas − detenciones no planificadas).</p></div>
                <div><label className="block text-sm font-semibold text-slate-800 mb-1">Registra tus unidades buenas</label><input type="number" min="0" max={productionRealPreview} className="w-full rounded-lg border border-emerald-300 p-3 text-lg font-semibold" value={lossForm.goodQty} onChange={(e) => setLossForm({...lossForm, goodQty: e.target.value})} placeholder={`Máximo calculado: ${productionRealPreview}`}/></div>
                {Number(lossForm.goodQty) < productionRealPreview && lossForm.goodQty !== '' && <div className="rounded-lg border border-amber-200 bg-amber-50 p-4"><p className="font-semibold text-amber-900">La producción real calculada es {productionRealPreview.toLocaleString()} unidades; sustenta las {(productionRealPreview - Number(lossForm.goodQty)).toLocaleString()} unidades no buenas.</p><div className="mt-3 grid grid-cols-2 gap-3"><div><label className="block text-sm font-medium text-amber-800 mb-1">A reproceso (und)</label><input type="number" min="0" className="w-full rounded-lg border border-amber-300 p-3 text-lg" value={lossForm.reprocessQty} onChange={(e) => setLossForm({...lossForm, reprocessQty: e.target.value})}/><p className="mt-1 text-xs text-slate-500">Puede volver a fabricarse.</p></div><div><label className="block text-sm font-medium text-rose-800 mb-1">A desperdicio (und)</label><input type="number" min="0" className="w-full rounded-lg border border-rose-300 p-3 text-lg" value={lossForm.wasteQty} onChange={(e) => setLossForm({...lossForm, wasteQty: e.target.value})}/><p className="mt-1 text-xs text-slate-500">No puede reprocesarse.</p></div></div><p className="mt-2 text-xs text-amber-800">Sustento registrado: {(Number(lossForm.reprocessQty) + Number(lossForm.wasteQty)).toLocaleString()} de {(productionRealPreview - Number(lossForm.goodQty)).toLocaleString()} unidades.</p></div>}
              </div>
            )}

            {requiresMaintenanceTicket && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <div className="flex gap-3">
                  <Wrench className="shrink-0 text-amber-600" />
                  <div className="flex-1">
                    <p className="font-semibold text-amber-900 text-sm">La avería requiere un ticket de mantenimiento</p>
                    <p className="mt-1 text-xs text-amber-800">Completa el detalle técnico antes de registrar el evento.</p>
                    {maintenanceTicket ? (
                      <p className="mt-3 inline-flex rounded bg-white px-2 py-1 text-xs font-bold text-amber-800">
                        Ticket generado: {maintenanceTicket.code}
                      </p>
                    ) : (
                      <Button variant="secondary" className="!mt-3 !border-amber-300 !bg-white !text-amber-800" onClick={() => setTicketModalOpen(true)}>
                        <Wrench size={16} /> Ticketera de mantenimiento
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{lossType === 'performance' ? 'Comentario de lo ocurrido' : 'Comentario (Opcional)'}</label>
              <textarea
                className="w-full border-slate-300 rounded-lg shadow-sm p-3 border focus:border-blue-500 focus:ring-blue-500" rows={3}
                placeholder={lossType === 'performance' ? 'Describe qué ocurrió durante el proceso y cómo afectó la operación...' : ''}
                value={lossForm.comment} onChange={(e) => setLossForm({...lossForm, comment: e.target.value})}
              ></textarea>
            </div>

            <Button 
              className="w-full !mt-6 !py-4 text-lg" 
              disabled={(lossType !== 'quality' && !lossForm.cause) || ((lossType === 'availability' || lossType === 'planned_availability') && ((Number(lossForm.durationHours) || 0) * 60 + (Number(lossForm.durationMinutes) || 0) <= 0)) || (lossType === 'performance' && !lossForm.comment.trim()) || (lossType === 'quality' && (!Number(lossForm.machineSpeed) || productionRealPreview <= 0 || lossForm.goodQty === '' || Number(lossForm.goodQty) > productionRealPreview || (Number(lossForm.goodQty) < productionRealPreview && Number(lossForm.reprocessQty) + Number(lossForm.wasteQty) !== productionRealPreview - Number(lossForm.goodQty)))) || (requiresMaintenanceTicket && !maintenanceTicket)}
              onClick={handleAddLoss}
            >
              {editingLossId ? 'Guardar cambios' : 'Registrar evento'}
            </Button>
          </div>
        </Modal>

        <Modal isOpen={ticketModalOpen} onClose={() => setTicketModalOpen(false)} title="Ticketera de mantenimiento">
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-4 text-sm">
              <p className="font-semibold text-slate-800">{activeSession.machine}</p>
              <p className="mt-1 text-slate-500">{lossForm.cause} · OT {activeSession.id}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Prioridad</label>
              <select className="w-full rounded-lg border border-slate-300 p-3" value={ticketForm.priority} onChange={(e) => setTicketForm({...ticketForm, priority: e.target.value})}>
                <option>Alta</option>
                <option>Media</option>
                <option>Baja</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Detalle de la avería</label>
              <textarea className="w-full rounded-lg border border-slate-300 p-3" rows={4} placeholder="Describe el síntoma, componente afectado y condición de la máquina." value={ticketForm.detail} onChange={(e) => setTicketForm({...ticketForm, detail: e.target.value})} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Reportado por</label>
              <input className="w-full rounded-lg border border-slate-300 p-3" value={ticketForm.reportedBy} onChange={(e) => setTicketForm({...ticketForm, reportedBy: e.target.value})} />
            </div>
            <Button className="w-full !py-3" disabled={!ticketForm.detail.trim() || !ticketForm.reportedBy.trim()} onClick={handleCreateMaintenanceTicket}>
              <Wrench size={18} /> Generar ticket
            </Button>
          </div>
        </Modal>

        <Modal isOpen={overweightModalOpen} onClose={() => setOverweightModalOpen(false)} title="Registrar sobrepeso">
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Indica la cantidad muestreada y registra el peso individual de cada unidad medida.</p>
            <div className="rounded-lg bg-cyan-50 p-3"><label className="text-sm font-semibold text-cyan-900">Peso objetivo / línea central (g)</label><input type="number" min="0" step="0.01" className="mt-1 w-full rounded border border-cyan-200 p-2" value={targetWeight} onChange={(event) => setTargetWeight(event.target.value)} placeholder="Ej. 250"/></div>
            {overweightDraft.map((sample, sampleIndex) => <div key={sampleIndex} className="space-y-3 rounded-lg border border-slate-200 p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto]"><div><label className="text-sm font-semibold text-slate-700">Cantidad muestreada</label><input type="number" min="1" max="100" className="mt-1 w-full rounded border border-slate-300 p-2" value={sample.sampleSize} onChange={(event) => updateSampleSize(sampleIndex, event.target.value)} placeholder="Ej. 5"/></div><TimeField label="Hora del muestreo" value={sample.time} onChange={(value) => updateSampleTime(sampleIndex, value)}/><button aria-label={`Eliminar muestreo ${sampleIndex + 1}`} disabled={overweightDraft.length === 1} onClick={() => setOverweightDraft(current => current.filter((_, index) => index !== sampleIndex))} className="self-end rounded p-2 text-rose-600 disabled:opacity-30"><Trash2 size={18}/></button></div>
              <div><p className="mb-2 text-sm font-semibold text-slate-700">Responsable de la medición</p><div className="inline-flex rounded-lg border border-slate-300 bg-slate-50 p-1">{[['PD','Producción'],['CC','Control de calidad']].map(([value,label]) => <button key={value} type="button" onClick={() => updateSampleMeasuredBy(sampleIndex, value)} className={`rounded-md px-3 py-2 text-sm font-semibold transition ${sample.measuredBy === value ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white'}`}>{value} · {label}</button>)}</div></div>
              {sample.weights.length > 0 && Number(sample.sampleSize) > 0 && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{sample.weights.map((weight, weightIndex) => <div key={weightIndex}><label className="text-xs font-semibold text-slate-500">Peso {weightIndex + 1} (g)</label><input type="number" min="0" step="0.01" className="mt-1 w-full rounded border border-slate-300 p-2" value={weight} onChange={(event) => updateSampleWeight(sampleIndex, weightIndex, event.target.value)}/></div>)}</div>}
            </div>)}
            <Button variant="secondary" className="w-full" onClick={addOverweightSample}><Plus size={18}/> Agregar otro muestreo</Button>
            <Button className="w-full" disabled={!validOverweightSamples} onClick={saveOverweights}>Guardar muestreos</Button>
          </div>
        </Modal>
        <Modal isOpen={materialModalOpen} onClose={() => setMaterialModalOpen(false)} title="Registrar descarte de material">
          <div className="space-y-4">
            <div><label className="mb-1 block text-sm font-semibold text-slate-700">Tipo de producto</label><select className="w-full rounded-lg border border-slate-300 bg-white p-3" value={materialForm.type} onChange={(event) => setMaterialForm({...materialForm,type:event.target.value})}><option>Envasado</option><option>Acondicionado</option></select></div>
            <div className="overflow-hidden rounded-xl border border-slate-300 bg-slate-100">
              <div className="border-b border-slate-300 bg-white px-4 py-2 text-center"><p className="font-bold text-slate-900">DESCARTE DE MATERIAL <span className="text-sm font-medium text-slate-500">(no afecta el OEE)</span></p></div>
              <div className="space-y-4 p-4">
                <div className="grid items-center gap-2 sm:grid-cols-[90px_1fr]"><label className="font-semibold text-slate-700">Motivo</label><input className="rounded border border-slate-300 bg-white p-2 font-medium uppercase" placeholder="Ej. PROBLEMA EN ACONDICIONADO" value={materialForm.reason} onChange={(event) => setMaterialForm({...materialForm,reason:event.target.value})}/></div>
                <div className="grid gap-3 md:grid-cols-[0.9fr_1.8fr_0.8fr_1fr]">
                  <div><label className="mb-1 block text-sm font-semibold text-slate-700">Código</label><input list="discard-product-codes" className="w-full rounded border border-yellow-400 bg-yellow-200 p-2 font-semibold uppercase" placeholder="K1553" value={materialForm.code} onChange={(event) => updateDiscardCode(event.target.value)}/><datalist id="discard-product-codes">{MATERIAL_PRODUCTS.map(item => <option key={item.code} value={item.code}>{item.description}</option>)}</datalist></div>
                  <div><label className="mb-1 block text-sm font-semibold text-slate-700">Descripción</label><input readOnly className="w-full rounded border border-yellow-400 bg-yellow-200 p-2 font-semibold text-slate-800" value={materialForm.description} placeholder="Automática según código"/></div>
                  <div><label className="mb-1 block text-sm font-semibold text-slate-700">Cantidad</label><input type="number" min="0" className="w-full rounded border border-slate-300 bg-white p-2 text-right font-semibold" value={materialForm.quantity} onChange={(event) => setMaterialForm({...materialForm,quantity:event.target.value})}/></div>
                  <div><label className="mb-1 block text-sm font-semibold text-slate-700">Unidad</label><input readOnly className="w-full rounded border border-yellow-400 bg-yellow-200 p-2 font-semibold text-slate-800" value={materialForm.unit}/></div>
                </div>
              </div>
            </div>
            <Button className="w-full" disabled={!materialForm.reason.trim() || !materialForm.description || Number(materialForm.quantity)<=0} onClick={saveMaterialDiscard}>Guardar descarte</Button>
          </div>
        </Modal>
      </div>
    );
  };

  const ValidationsView = () => {
    const [selectedRecord, setSelectedRecord] = useState(null);
    const [observationModalOpen, setObservationModalOpen] = useState(false);
    const [observationComment, setObservationComment] = useState('');
    const reviewRecords = records.filter(record => record.status === 'review');
    const observedRecords = records.filter(record => record.status === 'observed');
    const validatedRecords = records.filter(record => record.status === 'validated');

    const observeRecord = () => {
      if (!observationComment.trim()) return;
      const meeting = { code: `REU-${Date.now().toString().slice(-6)}`, attendee: selectedRecord.operator, date: new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString() };
      setRecords(current => current.map(record => record.id === selectedRecord.id ? { ...record, status: 'observed', observationComment, correctionMeeting: meeting } : record));
      setWorkOrders(current => current.map(order => order.id === (selectedRecord.workOrderId || selectedRecord.id.replace(/^REC-/, '')) ? { ...order, status: 'observed' } : order));
      setObservationComment('');
      setObservationModalOpen(false);
      setSelectedRecord(null);
      alert(`OT observada. Se asignó la reunión ${meeting.code} con ${meeting.attendee} para el ${meeting.date}.`);
    };

    const approveRecord = () => {
      setRecords(current => current.map(record => record.id === selectedRecord.id ? { ...record, status: 'validated' } : record));
      setWorkOrders(current => current.map(order => order.id === (selectedRecord.workOrderId || selectedRecord.id.replace(/^REC-/, '')) ? { ...order, status: 'validated' } : order));
      setSelectedRecord(null);
    };

    const StatusList = ({ title, records: statusRecords, variant, emptyMessage, selectable = false }: { title: string; records: any[]; variant: BadgeVariant; emptyMessage: string; selectable?: boolean }) => (
      <Card>
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between"><h3 className="font-bold text-slate-800">{title}</h3><Badge variant={variant}>{statusRecords.length}</Badge></div>
        {statusRecords.length === 0 ? <p className="p-6 text-center text-slate-500">{emptyMessage}</p> : <ul className="divide-y divide-slate-100">{statusRecords.map(record => <li key={record.id} className="p-4 flex items-center justify-between"><div><p className="font-semibold text-slate-800">{record.workOrderId || record.id.replace(/^REC-/, '')}</p><p className="text-sm text-slate-500">{record.machine} · {record.operator}</p>{record.observationComment && <p className="mt-1 text-sm text-rose-700">Observación: {record.observationComment}</p>}</div>{selectable && <Button variant="secondary" className="!px-3 !py-2" onClick={() => setSelectedRecord(record)}><Eye size={16}/> {record.status === 'review' ? 'Revisar' : 'Ver'}</Button>}</li>)}</ul>}
      </Card>
    );

    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <h2 className="text-2xl font-bold text-slate-800">Bandeja de Validaciones</h2>
        {selectedRecord ? (
          <Card>
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between bg-slate-50"><div className="flex items-center gap-4"><button onClick={() => setSelectedRecord(null)} className="p-2 hover:bg-slate-200 rounded-lg"><ArrowRight className="rotate-180" size={20} /></button><h3 className="text-lg font-bold">Detalle de OT: {selectedRecord.workOrderId || selectedRecord.id.replace(/^REC-/, '')}</h3></div><Badge variant={selectedRecord.status === 'validated' ? 'success' : 'warning'}>{WORK_ORDER_STATUS[selectedRecord.status]?.label || selectedRecord.status}</Badge></div>
            <div className="p-6 space-y-6"><RecordDetails record={selectedRecord} readOnly />
            {selectedRecord.status === 'review' && <div className="flex gap-4 border-t pt-4"><Button variant="danger" className="flex-1" onClick={() => setObservationModalOpen(true)}><Edit size={18}/> Observado</Button><Button variant="success" className="flex-1" onClick={approveRecord}><CheckCircle size={18}/> Aprobar y validar</Button></div>}</div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6"><StatusList title="OT en revisión" records={reviewRecords} variant="warning" emptyMessage="No hay OT en revisión." selectable /><StatusList title="OT observadas" records={observedRecords} variant="critical" emptyMessage="No hay OT observadas." /><StatusList title="OT aprobadas" records={validatedRecords} variant="success" emptyMessage="No hay OT aprobadas." selectable /></div>
        )}
        <Modal isOpen={observationModalOpen} onClose={() => setObservationModalOpen(false)} title="Observar OT">
          <div className="space-y-4"><p className="text-sm text-slate-600">Indica el comentario que el operario responsable deberá revisar.</p><textarea className="w-full rounded-lg border border-slate-300 p-3" rows={4} placeholder="Describe la observación..." value={observationComment} onChange={(event) => setObservationComment(event.target.value)} /><Button variant="danger" className="w-full" disabled={!observationComment.trim()} onClick={observeRecord}><Edit size={18}/> Enviar observación</Button></div>
        </Modal>
      </div>
    );
  };

  const AdministrationView = () => {
    const categoryLabels = { availability: 'Detenciones no planificadas' };
    const productionMachines = Array.from(new Set(plantEquipment.map(machine => machine.name).filter(Boolean))) as string[];
    const addCause = () => {
      const cause = adminNewCause.trim();
      if (!cause || lossCauses[adminLossCategory].some(item => item.toLowerCase() === cause.toLowerCase())) return;
      setLossCauses(current => ({ ...current, [adminLossCategory]: [...current[adminLossCategory], cause] }));
      setAdminNewCause('');
    };
    const renameCause = (category, cause) => {
      const next = window.prompt('Nuevo nombre del motivo:', cause)?.trim();
      if (!next || next === cause) return;
      setLossCauses(current => ({ ...current, [category]: current[category].map(item => item === cause ? next : item) }));
    };
    const removeCause = (category, cause) => {
      if (!window.confirm(`¿Quitar el motivo "${cause}" del listado?`)) return;
      setLossCauses(current => ({ ...current, [category]: current[category].filter(item => item !== cause) }));
    };
    const saveOperator = () => {
      const name = adminOperatorForm.name.trim();
      const machines = adminOperatorForm.machines;
      if (!name || !machines.length) return;
      setProductionLineOperators(current => adminEditingOperatorId
        ? current.map(item => item.id === adminEditingOperatorId ? { ...item, name, machines } : item)
        : [...current, { id: `OP-${Date.now().toString().slice(-6)}`, name, machines }]);
      setAdminOperatorForm({ name: '', machines: [] });
      setAdminEditingOperatorId('');
    };
    const editOperator = (operator) => {
      const machines = (operator.machines.includes('*') ? ['*'] : Array.from(new Set(operator.machines.map(assignment => plantEquipment.find(machine => machine.id === assignment)?.name || assignment)))) as string[];
      setAdminOperatorForm({ name: operator.name, machines });
      setAdminEditingOperatorId(operator.id);
    };
    const removeOperator = (operator) => {
      if (!window.confirm(`¿Quitar a ${operator.name} del listado de operarios?`)) return;
      setProductionLineOperators(current => current.filter(item => item.id !== operator.id));
    };
    const saveEquipment = () => {
      const name = adminEquipmentForm.name.trim();
      const line = adminEquipmentForm.line.trim();
      if (!name || !line) return;
      setPlantEquipment(current => adminEditingEquipmentId
        ? current.map(item => item.id === adminEditingEquipmentId ? { ...item, name, line } : item)
        : [...current, { id: `EQ-${Date.now().toString().slice(-6)}`, name, line, status: 'available' }]);
      setAdminEquipmentForm({ name: '', line: '' });
      setAdminEditingEquipmentId('');
    };
    const editEquipment = (equipment) => {
      setAdminEquipmentForm({ name: equipment.name, line: equipment.line });
      setAdminEditingEquipmentId(equipment.id);
    };
    const removeEquipment = (equipment) => {
      if (!window.confirm(`¿Quitar el equipo "${equipment.name}" de la planta?`)) return;
      setPlantEquipment(current => current.filter(item => item.id !== equipment.id));
    };
    return <div className="space-y-6 animate-in fade-in duration-300">
      <div><h2 className="text-2xl font-bold text-slate-800">Administración</h2><p className="text-slate-500">Selecciona primero la base de datos que deseas mantener.</p></div>
      <Card className="p-6"><label className="mb-2 block text-sm font-semibold text-slate-700">Área de edición</label><select value={adminSection} onChange={(event) => { setAdminSection(event.target.value); setAdminPlantSection(''); }} className="w-full rounded-lg border border-slate-300 bg-white p-3"><option value="">Seleccionar...</option><option value="stoppages">Detenciones</option><option value="plant">Planta</option></select></Card>
      {!adminSection && <Card className="p-10 text-center text-slate-500">Selecciona “Detenciones” o “Planta” para mostrar sus herramientas de edición.</Card>}
      {adminSection === 'stoppages' && <Card className="p-6"><h3 className="mb-4 text-lg font-bold text-slate-800">Base de motivos de detención</h3><label className="mb-1 block text-sm font-semibold text-slate-600">Tipo de registro</label><select value={adminLossCategory} onChange={(event) => setAdminLossCategory(event.target.value)} className="mb-4 w-full rounded-lg border border-slate-300 p-3">{Object.entries(categoryLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select><div className="mb-4 flex gap-2"><input value={adminNewCause} onChange={(event) => setAdminNewCause(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addCause()} className="min-w-0 flex-1 rounded-lg border border-slate-300 p-3" placeholder="Nuevo motivo..."/><Button className="!px-4" disabled={!adminNewCause.trim()} onClick={addCause}><Plus size={17}/> Añadir</Button></div><div className="space-y-2">{lossCauses[adminLossCategory].map(cause => <div key={cause} className="flex items-center gap-2 rounded-lg border border-slate-200 p-3"><span className="flex-1 text-sm font-medium">{cause}</span><button onClick={() => renameCause(adminLossCategory,cause)} className="rounded p-2 text-blue-600 hover:bg-blue-50" title="Editar"><Edit size={17}/></button><button onClick={() => removeCause(adminLossCategory,cause)} className="rounded p-2 text-rose-600 hover:bg-rose-50" title="Quitar"><Trash2 size={17}/></button></div>)}</div></Card>}
      {adminSection === 'plant' && <><Card className="p-6"><label className="mb-2 block text-sm font-semibold text-slate-700">Herramienta de planta</label><select value={adminPlantSection} onChange={(event) => setAdminPlantSection(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white p-3"><option value="">Seleccionar...</option><option value="personnel">Personal por máquina</option><option value="equipment">Máquinas y equipos</option></select></Card>
        {!adminPlantSection && <Card className="p-10 text-center text-slate-500">Selecciona “Personal por máquina” o “Máquinas y equipos”.</Card>}
        {adminPlantSection === 'personnel' && <Card className="p-6"><h3 className="mb-4 text-lg font-bold text-slate-800">Personal por máquina</h3><div className="mb-4 grid min-w-0 gap-3 md:grid-cols-2"><input value={adminOperatorForm.name} onChange={(event) => setAdminOperatorForm(current => ({...current,name:event.target.value}))} className="min-w-0 rounded-lg border border-slate-300 p-3" placeholder="Nombre del operario"/><div><select multiple value={adminOperatorForm.machines} onChange={(event) => setAdminOperatorForm(current => ({ ...current, machines: Array.from(event.target.selectedOptions, option => option.value) }))} className="h-36 w-full rounded-lg border border-slate-300 bg-white p-2"><option value="*">Todas las máquinas</option>{productionMachines.map(machine => <option key={machine} value={machine}>{machine}</option>)}</select><p className="mt-1 text-xs text-slate-500">Mantén Ctrl presionado para seleccionar varias máquinas.</p></div><div className="flex gap-2 md:col-span-2"><Button className="flex-1" disabled={!adminOperatorForm.name.trim() || !adminOperatorForm.machines.length} onClick={saveOperator}><Plus size={17}/> {adminEditingOperatorId ? 'Guardar cambios' : 'Añadir operario'}</Button>{adminEditingOperatorId && <Button variant="secondary" onClick={() => { setAdminEditingOperatorId(''); setAdminOperatorForm({ name: '', machines: [] }); }}>Cancelar</Button>}</div></div><div className="space-y-2">{productionLineOperators.map(operator => <div key={operator.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-3"><div className="min-w-0 flex-1"><p className="font-medium text-slate-800">{operator.name}</p><p className="text-xs text-slate-500">{operator.machines.includes('*') ? 'Todas las máquinas' : operator.machines.join(', ')}</p></div><button onClick={() => editOperator(operator)} className="rounded p-2 text-blue-600 hover:bg-blue-50" title="Editar"><Edit size={17}/></button><button onClick={() => removeOperator(operator)} className="rounded p-2 text-rose-600 hover:bg-rose-50" title="Quitar"><Trash2 size={17}/></button></div>)}</div></Card>}
        {adminPlantSection === 'equipment' && <Card className="p-6"><h3 className="mb-4 text-lg font-bold text-slate-800">Equipos y líneas</h3><div className="mb-5 grid gap-3 md:grid-cols-2"><input value={adminEquipmentForm.name} onChange={(event) => setAdminEquipmentForm(current => ({ ...current, name: event.target.value }))} className="rounded-lg border border-slate-300 p-3" placeholder="Equipo (ej. Blistera B-01)"/><input value={adminEquipmentForm.line} onChange={(event) => setAdminEquipmentForm(current => ({ ...current, line: event.target.value }))} className="rounded-lg border border-slate-300 p-3" placeholder="Línea de producción"/><div className="flex gap-2 md:col-span-2"><Button className="flex-1" disabled={!adminEquipmentForm.name.trim() || !adminEquipmentForm.line.trim()} onClick={saveEquipment}><Plus size={17}/> {adminEditingEquipmentId ? 'Guardar cambios' : 'Añadir equipo'}</Button>{adminEditingEquipmentId && <Button variant="secondary" onClick={() => { setAdminEditingEquipmentId(''); setAdminEquipmentForm({ name: '', line: '' }); }}>Cancelar</Button>}</div></div><div className="space-y-2">{plantEquipment.map(equipment => <div key={equipment.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-3"><div className="min-w-0 flex-1"><p className="font-medium text-slate-800">{equipment.name}</p><p className="text-xs text-slate-500">{equipment.line}</p></div><button onClick={() => editEquipment(equipment)} className="rounded p-2 text-blue-600 hover:bg-blue-50" title="Editar"><Edit size={17}/></button><button onClick={() => removeEquipment(equipment)} className="rounded p-2 text-rose-600 hover:bg-rose-50" title="Quitar"><Trash2 size={17}/></button></div>)}</div></Card>}
      </>}
    </div>;
  };

  const AIAssistantView = () => {
    const [messages, setMessages] = useState([
      { role: 'ai', text: 'Hola Carlos. He analizado las detenciones no planificadas registradas. ¿Qué equipo, causa u orden deseas revisar?' }
    ]);
    const [input, setInput] = useState('');
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }

    useEffect(() => { scrollToBottom(); }, [messages]);

    const handleSend = () => {
      if (!input.trim()) return;
      
      const newMessages = [...messages, { role: 'user', text: input }];
      setMessages(newMessages);
      setInput('');

      // Simulate AI response delay
      setTimeout(() => {
        let aiResponse = "He revisado la base de datos. ";
        const lowerInput = input.toLowerCase();
        
        if(lowerInput.includes('avería') || lowerInput.includes('pérdida')) {
          aiResponse += "Las averías concentran la mayor parte del tiempo de detención no planificada. Conviene priorizar el equipo con más minutos acumulados.";
        } else if (lowerInput.includes('disponibilidad') || lowerInput.includes('tendencia')) {
          aiResponse += "La disponibilidad se calcula usando el tiempo de operación registrado menos las detenciones no planificadas.";
        } else {
          aiResponse += "Las principales oportunidades se muestran por causa, máquina y orden de trabajo para facilitar la priorización del mantenimiento.";
        }

        setMessages([...newMessages, { role: 'ai', text: aiResponse }]);
      }, 1500);
    };

    return (
      <div className="h-[calc(100vh-8rem)] flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in duration-300">
        <div className="bg-slate-900 p-4 text-white flex items-center gap-3">
          <div className="bg-blue-500 p-2 rounded-full"><Bot size={24} /></div>
          <div>
            <h2 className="font-bold">Asistente OEE Analítico</h2>
            <p className="text-xs text-blue-200">Impulsado por IA - Analizando históricos MES</p>
          </div>
        </div>
        
        <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-slate-50">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] p-4 rounded-2xl ${
                msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-white border border-slate-200 text-slate-800 shadow-sm rounded-tl-sm'
              }`}>
                {msg.text}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-4 bg-white border-t border-slate-200 flex gap-2">
          <input 
            type="text" 
            placeholder="Pregunta sobre causas, tendencias o máquinas..." 
            className="flex-1 border-slate-300 rounded-lg shadow-sm p-3 border focus:border-blue-500 focus:ring-blue-500"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
          />
          <Button variant="primary" onClick={handleSend} className="!px-4">
            <Send size={20} />
          </Button>
        </div>
      </div>
    );
  };

  const AlertCircleIcon = () => <AlertTriangle size={18} />;

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-800 overflow-hidden">
      {/* Sidebar */}
      <aside className={`${isSidebarOpen ? 'w-64' : 'w-20'} bg-slate-900 text-slate-300 flex flex-col transition-all duration-300 z-50 shadow-xl`}>
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800 bg-slate-950">
          {isSidebarOpen && <span className="font-bold text-lg text-white tracking-tight flex items-center gap-2"><BiomontLogo className="w-24 h-auto" /> <span>BIOEE B</span></span>}
          <button onClick={() => setSidebarOpen(!isSidebarOpen)} className="p-1 hover:bg-slate-800 rounded">
            {isSidebarOpen ? <X size={20} /> : <BiomontLogo className="w-10 h-auto" />}
          </button>
        </div>
        
        <div className="p-4 flex-1 space-y-2 overflow-y-auto">
          {role === 'supervisor' && <SidebarItem icon={LayoutDashboard} label="Dashboard" viewId="dashboard" />}
          <SidebarItem icon={ClipboardList} label="Órdenes (OT)" viewId="work_orders" />
          {role === 'supervisor' && <SidebarItem icon={CheckSquare} label="Validaciones" viewId="validations" />}
          {role === 'supervisor' && <SidebarItem icon={Settings} label="Administración" viewId="administration" />}
          {role === 'supervisor' && <SidebarItem icon={Bot} label="Asistente IA" viewId="ai" />}
        </div>

        <div className="p-4 border-t border-slate-800">
          <button onClick={logout} className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-rose-400 hover:bg-rose-500/10 transition-colors">
            <LogOut size={20} />
            {isSidebarOpen && <span>Cerrar Sesión</span>}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Topbar */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 shadow-sm z-40">
          <div className="flex items-center gap-4">
             {activeSession && (
               <Badge variant="warning" className="animate-pulse flex items-center gap-2">
                 <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                 Producción Activa: {activeSession.id}
               </Badge>
             )}
          </div>
          <div className="flex items-center gap-6">
            <button className="relative text-slate-400 hover:text-slate-600">
              <Bell size={20} />
              {records.filter(r => r.status === 'review').length > 0 && role === 'supervisor' && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-white"></span>
              )}
            </button>
            <div className="flex items-center gap-3 border-l border-slate-200 pl-6">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-slate-800">{currentUser.name}</p>
                <p className="text-xs text-slate-500">{role === 'supervisor' ? 'Supervisor Planta' : 'Operario responsable'}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold border border-blue-200">
                {currentUser.name.charAt(0)}
              </div>
            </div>
          </div>
        </header>

        {/* Dynamic Content Scrollable Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-slate-50">
          <div className="max-w-7xl mx-auto">
            {currentView === 'dashboard' && <DashboardView />}
            {currentView === 'work_orders' && WorkOrdersView()}
            {currentView === 'active_production' && <ActiveProductionView />}
            {currentView === 'validations' && <ValidationsView />}
            {currentView === 'administration' && AdministrationView()}
            {currentView === 'ai' && <AIAssistantView />}
          </div>
        </div>
      </main>
    </div>
  );
}

