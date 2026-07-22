import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

import authRoutes from './routes/auth.routes.js';
import employeesRoutes from './routes/employees.routes.js';
import orgRoutes from './routes/org.routes.js';
import clientsRoutes from './routes/clients.routes.js';
import attendanceRulesRoutes from './routes/attendanceRules.routes.js';
import attendanceRoutes from './routes/attendance.routes.js';
import documentsRoutes from './routes/documents.routes.js';
import onboardingRoutes from './routes/onboarding.routes.js';
import leaveRoutes from './routes/leave.routes.js';
import payrollRoutes from './routes/payroll.routes.js';
import exitRoutes from './routes/exit.routes.js';
import adminRoutes from './routes/admin.routes.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: env.frontendUrl, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(morgan(env.nodeEnv === 'development' ? 'dev' : 'combined'));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500 });
app.use('/api', apiLimiter);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'ESTRADA HRIS API' }));

app.use('/api/auth', authRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/org', orgRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/attendance-rules', attendanceRulesRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/exit', exitRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
