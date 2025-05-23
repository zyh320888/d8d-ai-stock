import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getLocalStorageWithExpiry, setLocalStorageWithExpiry } from './utils.ts';
import type { User, AuthContextType, ThemeContextType, ThemeSettings } from '../share/types.ts';
import { ThemeMode, FontSize, CompactMode } from '../share/types.ts';
import { AuthAPI, ThemeAPI } from './api.ts';

// 创建axios实例
const api = axios.create({
  baseURL: window.CONFIG?.API_BASE_URL || '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  }
});

// 请求拦截器添加token
api.interceptors.request.use(
  (config) => {
    const token = getLocalStorageWithExpiry('token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器处理错误
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response && error.response.status === 401) {
      // 清除本地存储并刷新页面
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/mobile/login';
    }
    return Promise.reject(error);
  }
);

// 默认主题设置
const defaultThemeSettings: ThemeSettings = {
  user_id: 0,
  theme_mode: ThemeMode.LIGHT,
  primary_color: '#3B82F6', // 蓝色
  background_color: '#F9FAFB',
  text_color: '#111827',
  border_radius: 8,
  font_size: FontSize.MEDIUM,
  is_compact: CompactMode.NORMAL
};

// 创建认证上下文
const AuthContext = createContext<AuthContextType | null>(null);

// 创建主题上下文
const ThemeContext = createContext<ThemeContextType | null>(null);

// 认证提供者组件
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(getLocalStorageWithExpiry('token'));
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const queryClient = useQueryClient();

  // 使用useQuery检查登录状态
  const { isLoading: isAuthChecking } = useQuery({
    queryKey: ['auth', 'status', token],
    queryFn: async () => {
      if (!token) {
        setUser(null);
        setIsAuthenticated(false);
        return null;
      }
      
      try {
        // 设置请求头
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        // 获取当前用户信息
        const currentUser = await AuthAPI.getCurrentUser();
        setUser(currentUser);
        setIsAuthenticated(true);
        setLocalStorageWithExpiry('user', currentUser, 24);
        return { isValid: true, user: currentUser };
      } catch (error) {
        // 如果API调用失败，自动登出
        logout();
        return { isValid: false };
      }
    },
    enabled: !!token,
    refetchOnWindowFocus: false,
    retry: false,
  });
  

  // 登录函数
  const login = async (username: string, password: string) => {
    try {
      const response = await AuthAPI.login(username, password);
      const { token, user } = response;
      
      // 保存到状态和本地存储
      setToken(token);
      setUser(user);
      setLocalStorageWithExpiry('token', token, 24); // 24小时过期
      setLocalStorageWithExpiry('user', user, 24);
      
      // 设置请求头
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      
    } catch (error) {
      console.error('登录失败:', error);
      throw error;
    }
  };

  // 登出函数
  const logout = async () => {
    try {
      // 调用登出API
      await AuthAPI.logout();
    } catch (error) {
      console.error('登出API调用失败:', error);
    } finally {
      // 无论API调用成功与否，都清除本地状态
      setToken(null);
      setUser(null);
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      // 清除请求头
      delete api.defaults.headers.common['Authorization'];
      // 清除所有查询缓存
      queryClient.clear();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
        isAuthenticated,
        isLoading: isAuthChecking
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// 主题提供者组件
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentTheme, setCurrentTheme] = useState<ThemeSettings>(() => {
    const storedTheme = localStorage.getItem('theme');
    return storedTheme ? JSON.parse(storedTheme) : defaultThemeSettings;
  });
  
  const isDark = currentTheme.theme_mode === ThemeMode.DARK;

  // 更新主题（实时预览）
  const updateTheme = (theme: Partial<ThemeSettings>) => {
    setCurrentTheme(prev => {
      const updatedTheme = { ...prev, ...theme };
      localStorage.setItem('theme', JSON.stringify(updatedTheme));
      return updatedTheme;
    });
  };

  // 保存主题到后端
  const saveTheme = async (theme: Partial<ThemeSettings>): Promise<ThemeSettings> => {
    try {
      const updatedTheme = { ...currentTheme, ...theme };
      const data = await ThemeAPI.updateThemeSettings(updatedTheme);
      
      setCurrentTheme(data);
      localStorage.setItem('theme', JSON.stringify(data));
      
      return data;
    } catch (error) {
      console.error('保存主题失败:', error);
      throw error;
    }
  };

  // 重置主题
  const resetTheme = async (): Promise<ThemeSettings> => {
    try {
      const data = await ThemeAPI.resetThemeSettings();
      
      setCurrentTheme(data);
      localStorage.setItem('theme', JSON.stringify(data));
      
      return data;
    } catch (error) {
      console.error('重置主题失败:', error);
      
      // 如果API失败，至少重置到默认主题
      setCurrentTheme(defaultThemeSettings);
      localStorage.setItem('theme', JSON.stringify(defaultThemeSettings));
      
      return defaultThemeSettings;
    }
  };

  // 切换主题模式（亮色/暗色）
  const toggleTheme = () => {
    const newMode = isDark ? ThemeMode.LIGHT : ThemeMode.DARK;
    const updatedTheme = {
      ...currentTheme,
      theme_mode: newMode,
      // 暗色和亮色模式下自动调整背景色和文字颜色
      background_color: newMode === ThemeMode.DARK ? '#121212' : '#F9FAFB',
      text_color: newMode === ThemeMode.DARK ? '#E5E7EB' : '#111827'
    };
    
    setCurrentTheme(updatedTheme);
    localStorage.setItem('theme', JSON.stringify(updatedTheme));
  };

  // 主题变化时应用CSS变量
  useEffect(() => {
    document.documentElement.style.setProperty('--primary-color', currentTheme.primary_color);
    document.documentElement.style.setProperty('--background-color', currentTheme.background_color || '#F9FAFB');
    document.documentElement.style.setProperty('--text-color', currentTheme.text_color || '#111827');
    document.documentElement.style.setProperty('--border-radius', `${currentTheme.border_radius || 8}px`);
    
    // 设置字体大小
    let rootFontSize = '16px'; // 默认中等字体
    if (currentTheme.font_size === FontSize.SMALL) {
      rootFontSize = '14px';
    } else if (currentTheme.font_size === FontSize.LARGE) {
      rootFontSize = '18px';
    }
    document.documentElement.style.setProperty('--font-size', rootFontSize);
    
    // 设置暗色模式类
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [currentTheme, isDark]);

  return (
    <ThemeContext.Provider
      value={{
        isDark,
        currentTheme,
        updateTheme,
        saveTheme,
        resetTheme,
        toggleTheme
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

// 使用上下文的钩子
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth必须在AuthProvider内部使用');
  }
  return context;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme必须在ThemeProvider内部使用');
  }
  return context;
};