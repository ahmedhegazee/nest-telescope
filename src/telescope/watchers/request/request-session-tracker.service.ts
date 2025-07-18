import { Injectable, Logger } from '@nestjs/common';
import { RequestContext, ResponseContext } from './request-watcher.interceptor';

export interface SessionInfo {
  id: string;
  userId?: string;
  startTime: Date;
  lastActivity: Date;
  requestCount: number;
  totalDuration: number;
  averageResponseTime: number;
  errorCount: number;
  pages: string[];
  userAgent: string;
  ipAddress: string;
  isActive: boolean;
}

export interface UserSession {
  sessionId: string;
  userId?: string;
  requests: SessionRequest[];
  startTime: Date;
  endTime?: Date;
  duration: number;
  isActive: boolean;
  metadata: SessionMetadata;
}

export interface SessionRequest {
  id: string;
  method: string;
  url: string;
  statusCode: number;
  duration: number;
  timestamp: Date;
  error?: string;
}

export interface SessionMetadata {
  userAgent: string;
  ipAddress: string;
  initialReferrer?: string;
  totalPages: number;
  uniquePages: number;
  bounceRate: number;
  avgTimePerPage: number;
}

@Injectable()
export class RequestSessionTracker {
  private readonly logger = new Logger(RequestSessionTracker.name);
  private readonly sessions = new Map<string, SessionInfo>();
  private readonly userSessions = new Map<string, UserSession>();
  private readonly sessionTimeout = 30 * 60 * 1000; // 30 minutes
  private readonly cleanupInterval = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.startCleanupTimer();
  }

  trackRequest(
    requestContext: RequestContext,
    responseContext: ResponseContext,
    error: Error | null
  ): void {
    try {
      // Track by session ID if available
      if (requestContext.sessionId) {
        this.trackSessionRequest(requestContext, responseContext, error);
      }

      // Track by user ID if available
      if (requestContext.userId) {
        this.trackUserSession(requestContext, responseContext, error);
      }
    } catch (trackingError) {
      this.logger.error('Failed to track session request:', trackingError);
    }
  }

  private trackSessionRequest(
    requestContext: RequestContext,
    responseContext: ResponseContext,
    error: Error | null
  ): void {
    const sessionId = requestContext.sessionId!;
    let session = this.sessions.get(sessionId);

    if (!session) {
      session = {
        id: sessionId,
        userId: requestContext.userId,
        startTime: new Date(requestContext.startTime),
        lastActivity: new Date(requestContext.startTime),
        requestCount: 0,
        totalDuration: 0,
        averageResponseTime: 0,
        errorCount: 0,
        pages: [],
        userAgent: requestContext.userAgent,
        ipAddress: requestContext.ip,
        isActive: true
      };
      this.sessions.set(sessionId, session);
    }

    // Update session info
    session.lastActivity = new Date(responseContext.endTime);
    session.requestCount++;
    session.totalDuration += responseContext.duration;
    session.averageResponseTime = session.totalDuration / session.requestCount;

    if (error || responseContext.statusCode >= 400) {
      session.errorCount++;
    }

    // Track unique pages
    const page = this.extractPageFromUrl(requestContext.url);
    if (page && !session.pages.includes(page)) {
      session.pages.push(page);
    }

    // Update user ID if it became available
    if (requestContext.userId && !session.userId) {
      session.userId = requestContext.userId;
    }
  }

  private trackUserSession(
    requestContext: RequestContext,
    responseContext: ResponseContext,
    error: Error | null
  ): void {
    const userId = requestContext.userId!;
    const sessionKey = `${userId}_${requestContext.sessionId || requestContext.ip}`;
    
    let userSession = this.userSessions.get(sessionKey);

    if (!userSession) {
      userSession = {
        sessionId: requestContext.sessionId || this.generateSessionId(),
        userId,
        requests: [],
        startTime: new Date(requestContext.startTime),
        duration: 0,
        isActive: true,
        metadata: {
          userAgent: requestContext.userAgent,
          ipAddress: requestContext.ip,
          initialReferrer: requestContext.headers.referer,
          totalPages: 0,
          uniquePages: 0,
          bounceRate: 0,
          avgTimePerPage: 0
        }
      };
      this.userSessions.set(sessionKey, userSession);
    }

    // Add request to session
    const sessionRequest: SessionRequest = {
      id: requestContext.id,
      method: requestContext.method,
      url: requestContext.url,
      statusCode: responseContext.statusCode,
      duration: responseContext.duration,
      timestamp: new Date(requestContext.startTime),
      error: error?.message
    };

    userSession.requests.push(sessionRequest);
    userSession.duration = responseContext.endTime - userSession.startTime.getTime();
    userSession.isActive = true;

    // Update metadata
    this.updateSessionMetadata(userSession);
  }

  private updateSessionMetadata(session: UserSession): void {
    const requests = session.requests;
    const pages = new Set(requests.map(req => this.extractPageFromUrl(req.url)).filter(Boolean));
    
    session.metadata.totalPages = requests.length;
    session.metadata.uniquePages = pages.size;
    session.metadata.bounceRate = pages.size === 1 ? 100 : 0;
    
    if (requests.length > 0) {
      const totalDuration = requests.reduce((sum, req) => sum + req.duration, 0);
      session.metadata.avgTimePerPage = totalDuration / requests.length;
    }
  }

  private extractPageFromUrl(url: string): string {
    try {
      const urlObj = new URL(url, 'http://localhost');
      return urlObj.pathname;
    } catch {
      return url.split('?')[0];
    }
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private startCleanupTimer(): void {
    setInterval(() => {
      this.cleanupInactiveSessions();
    }, this.cleanupInterval);
  }

  private cleanupInactiveSessions(): void {
    const now = Date.now();
    let cleanedSessions = 0;
    let cleanedUserSessions = 0;

    // Cleanup regular sessions
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity.getTime() > this.sessionTimeout) {
        session.isActive = false;
        this.sessions.delete(sessionId);
        cleanedSessions++;
      }
    }

    // Cleanup user sessions
    for (const [sessionKey, userSession] of this.userSessions) {
      const lastActivity = userSession.requests.length > 0 
        ? userSession.requests[userSession.requests.length - 1].timestamp.getTime()
        : userSession.startTime.getTime();
      
      if (now - lastActivity > this.sessionTimeout) {
        userSession.isActive = false;
        userSession.endTime = new Date(lastActivity);
        this.userSessions.delete(sessionKey);
        cleanedUserSessions++;
      }
    }

    if (cleanedSessions > 0 || cleanedUserSessions > 0) {
      this.logger.debug(`Cleaned up ${cleanedSessions} sessions and ${cleanedUserSessions} user sessions`);
    }
  }

  getSessionInfo(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  getUserSession(userId: string, sessionId?: string): UserSession | undefined {
    if (sessionId) {
      return this.userSessions.get(`${userId}_${sessionId}`);
    }

    // Find most recent session for user
    const userSessions = Array.from(this.userSessions.values())
      .filter(session => session.userId === userId)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());

    return userSessions[0];
  }

  getActiveSessions(): SessionInfo[] {
    return Array.from(this.sessions.values())
      .filter(session => session.isActive)
      .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
  }

  getActiveUserSessions(): UserSession[] {
    return Array.from(this.userSessions.values())
      .filter(session => session.isActive)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  }

  getSessionsByUser(userId: string): UserSession[] {
    return Array.from(this.userSessions.values())
      .filter(session => session.userId === userId)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  }

  getSessionStats(): {
    totalSessions: number;
    activeSessions: number;
    averageSessionDuration: number;
    averageRequestsPerSession: number;
    bounceRate: number;
    topPages: Array<{ page: string; visits: number }>;
  } {
    const allSessions = Array.from(this.sessions.values());
    const activeSessions = allSessions.filter(s => s.isActive);
    
    const totalDuration = allSessions.reduce((sum, s) => {
      return sum + (s.lastActivity.getTime() - s.startTime.getTime());
    }, 0);
    
    const totalRequests = allSessions.reduce((sum, s) => sum + s.requestCount, 0);
    
    const singlePageSessions = allSessions.filter(s => s.pages.length <= 1).length;
    const bounceRate = allSessions.length > 0 ? (singlePageSessions / allSessions.length) * 100 : 0;
    
    // Calculate top pages
    const pageVisits = new Map<string, number>();
    allSessions.forEach(session => {
      session.pages.forEach(page => {
        pageVisits.set(page, (pageVisits.get(page) || 0) + 1);
      });
    });
    
    const topPages = Array.from(pageVisits.entries())
      .map(([page, visits]) => ({ page, visits }))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 10);

    return {
      totalSessions: allSessions.length,
      activeSessions: activeSessions.length,
      averageSessionDuration: allSessions.length > 0 ? totalDuration / allSessions.length : 0,
      averageRequestsPerSession: allSessions.length > 0 ? totalRequests / allSessions.length : 0,
      bounceRate,
      topPages
    };
  }

  invalidateSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.isActive = false;
      this.sessions.delete(sessionId);
    }
  }

  clearAllSessions(): void {
    this.sessions.clear();
    this.userSessions.clear();
  }
}