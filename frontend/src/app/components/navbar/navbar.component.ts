import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { User } from '../../models/user.model';
import { MessageService } from '../../core/services/message.service';
import { SocketService } from '../../core/services/socket.service';
import { Subscription } from 'rxjs';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss']
})
export class NavbarComponent implements OnInit, OnDestroy {
  currentUser: User | null = null;
  isLoggedIn = false;
  isAdmin = false;
  notificationCount = 0;
  apiUrl = environment.apiUrl.replace('/api', '');

  private subscriptions: Subscription[] = [];

  constructor(
    public authService: AuthService,
    private router: Router,
    private messageService: MessageService,
    private socketService: SocketService
  ) {}

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
      this.isLoggedIn = !!user;
      this.isAdmin = user?.role === 'Admin';
      
      if (user) {
        this.loadNotificationCount();
        this.setupSocketListeners();
      }
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  loadNotificationCount(): void {
    this.messageService.getNotifications(true).subscribe({
      next: (response) => {
        this.notificationCount = response.unreadCount;
      }
    });
  }

  setupSocketListeners(): void {
    this.socketService.connect();
    
    this.subscriptions.push(
      this.socketService.onNotification().subscribe(() => {
        this.notificationCount++;
      })
    );

    this.subscriptions.push(
      this.messageService.notificationCount$.subscribe(count => {
        this.notificationCount = count;
      })
    );
  }

  logout(): void {
    this.socketService.disconnect();
    this.authService.logout();
  }

  navigateTo(path: string): void {
    this.router.navigate([path]);
  }

  getProfilePictureUrl(): string | null {
    if (this.currentUser?.profile_picture) {
      return `${this.apiUrl}/${this.currentUser.profile_picture}`;
    }
    return null;
  }
}
