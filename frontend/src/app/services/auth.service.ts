import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { Router } from '@angular/router';
import { User, AuthResponse, LoginRequest, RegisterRequest, UserStats } from '../models/user.model';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private apiUrl = `${environment.apiUrl}/auth`;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor(private http: HttpClient, private router: Router) {
    this.loadUserFromStorage();
  }

  private loadUserFromStorage(): void {
    const token = this.getToken();
    const userStr = localStorage.getItem('user');
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr);
        this.currentUserSubject.next(user);
      } catch (e) {
        this.logout();
      }
    }
  }

  register(data: RegisterRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/register`, data).pipe(
      tap(response => {
        this.setSession(response);
      })
    );
  }

  login(credentials: LoginRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/login`, credentials).pipe(
      tap(response => {
        this.setSession(response);
      })
    );
  }

  logout(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.currentUserSubject.next(null);
    this.router.navigate(['/login']);
  }

  private setSession(authResult: AuthResponse): void {
    localStorage.setItem('token', authResult.token);
    localStorage.setItem('user', JSON.stringify(authResult.user));
    this.currentUserSubject.next(authResult.user);
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  isAdmin(): boolean {
    const user = this.getCurrentUser();
    return user?.role === 'Admin';
  }

  isTraveler(): boolean {
    const user = this.getCurrentUser();
    return user?.role === 'Traveler';
  }

  getProfile(): Observable<{ user: User }> {
    return this.http.get<{ user: User }>(`${this.apiUrl}/profile`);
  }

  updateProfile(data: { name: string; email: string; contact_info?: string }): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.apiUrl}/profile`, data);
  }

  uploadProfilePicture(file: File): Observable<{ message: string; profile_picture: string }> {
    const formData = new FormData();
    formData.append('profile_picture', file);
    return this.http.post<{ message: string; profile_picture: string }>(`${this.apiUrl}/profile/picture`, formData);
  }

  removeProfilePicture(): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/profile/picture`);
  }

  updateCurrentUser(updates: Partial<User>): void {
    const user = this.getCurrentUser();
    if (user) {
      const updatedUser = { ...user, ...updates };
      localStorage.setItem('user', JSON.stringify(updatedUser));
      this.currentUserSubject.next(updatedUser);
    }
  }

  changePassword(data: { currentPassword: string; newPassword: string }): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.apiUrl}/change-password`, data);
  }

  getAllUsers(): Observable<{ users: User[] }> {
    return this.http.get<{ users: User[] }>(`${this.apiUrl}/users`);
  }

  // Admin Management Methods
  getUserStats(): Observable<{ stats: UserStats }> {
    return this.http.get<{ stats: UserStats }>(`${this.apiUrl}/users/stats`);
  }

  updateUserRole(userId: number, role: 'Traveler' | 'Admin'): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.apiUrl}/users/${userId}/role`, { role });
  }

  updateUserStatus(userId: number, status: 'active' | 'suspended'): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(`${this.apiUrl}/users/${userId}/status`, { status });
  }

  deleteUser(userId: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/users/${userId}`);
  }
}
