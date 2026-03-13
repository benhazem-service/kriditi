import React, { useState, useEffect, useMemo, useRef } from 'react';
import { cn, normalizeArabic } from './lib/utils';
import { Logo } from './components/Logo';
import { NumericKeypad } from './components/NumericKeypad';
import { 
  Plus, 
  Search, 
  User as UserIcon, 
  TrendingUp, 
  TrendingDown, 
  ChevronRight, 
  ArrowLeft,
  Phone,
  Calendar,
  Mic,
  Square,
  Play,
  Camera,
  AlertCircle,
  Volume2,
  UserPlus,
  Database,
  Trash2,
  Edit,
  MessageCircle,
  Lock,
  Home,
  LogOut,
  Wifi,
  WifiOff,
  X,
  Download,
  FileJson,
  FileText,
  Settings
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut, 
  signInAnonymously,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  ConfirmationResult,
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  query, 
  where, 
  setDoc, 
  doc, 
  deleteDoc,
  writeBatch,
  orderBy
} from 'firebase/firestore';
import { auth, db, googleProvider } from './firebase';

// --- Types ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // We don't want to crash the whole app for the user, but we want to log it clearly
  // and maybe show a friendly message.
  alert("وقع مشكل فالحفظ. تأكد من الأنترنيت وعاود جرب.");
  throw new Error(JSON.stringify(errInfo));
};

interface Customer {
  id: string;
  customerNumber?: string;
  name?: string;
  phone?: string;
  gender: 'male' | 'female';
  totalBalance: number;
  photoBase64?: string;
  voiceBase64?: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

interface Transaction {
  id: string;
  customerId: string;
  amount: number;
  type: 'credit' | 'payment';
  voiceBase64?: string;
  photoBase64?: string;
  ownerId: string;
  date: string;
}

// --- Helpers ---
const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

const getDaysSince = (dateString: string) => {
  return differenceInDays(new Date(), new Date(dateString));
};

// --- Components ---

const AudioPlayer = ({ base64, label }: { base64: string, label?: string }) => {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Reset audio ref if base64 changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlaying(false);
    }
  }, [base64]);

  const play = () => {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }

    if (!audioRef.current) {
      audioRef.current = new Audio(base64);
      audioRef.current.onended = () => setPlaying(false);
      audioRef.current.onerror = (e) => {
        console.error("Audio playback error", e);
        setPlaying(false);
      };
    }
    
    audioRef.current.play().catch(err => {
      console.error("Play failed", err);
      setPlaying(false);
    });
    setPlaying(true);
  };

  return (
    <button 
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); play(); }}
      className={cn(
        "flex items-center gap-2 px-3 py-2 rounded-full transition-all",
        playing ? "bg-indigo-600 text-white animate-pulse" : "bg-indigo-100 text-indigo-600 hover:bg-indigo-200"
      )}
    >
      {playing ? <Square className="w-4 h-4 fill-current" /> : <Volume2 className="w-4 h-4" />}
      {label && <span className="text-xs font-bold">{label}</span>}
    </button>
  );
};

const VoiceButton = ({ onRecordingComplete, className }: { onRecordingComplete?: (base64: string) => void, className?: string }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const isHoldingRef = useRef(false);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>('');

  const startRecording = async (e: React.MouseEvent | React.TouchEvent) => {
    if (e) e.preventDefault();
    if (isHoldingRef.current) return;
    
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      setError("متصفحك لا يدعم تسجيل الصوت.");
      return;
    }

    isHoldingRef.current = true;
    setError(null);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      if (!isHoldingRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
        ? 'audio/webm' 
        : MediaRecorder.isTypeSupported('audio/mp4') 
          ? 'audio/mp4' 
          : 'audio/ogg';
          
      mimeTypeRef.current = mimeType;
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onerror = (err) => {
        console.error("MediaRecorder error:", err);
        setError("خطأ في التسجيل. حاول مرة أخرى.");
        stopRecording(null as any);
      };
      recorder.onstop = async () => {
        const currentChunks = [...chunksRef.current];
        chunksRef.current = [];
        
        if (currentChunks.length === 0) {
          setIsRecording(false);
          return;
        }
        
        const blob = new Blob(currentChunks, { type: mimeType });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64data = reader.result as string;
          if (onRecordingComplete) onRecordingComplete(base64data);
        };
      };
      
      recorder.start();
      setIsRecording(true);

      // Safety timeout: stop recording after 60 seconds if user is still holding
      setTimeout(() => {
        if (isHoldingRef.current) {
          stopRecording(null as any);
        }
      }, 60000);

    } catch (err) {
      console.error("Mic access denied", err);
      setError("عطي الصلاحية للميكروفون");
      isHoldingRef.current = false;
      setIsRecording(false);
    }
  };

  const stopRecording = (e: React.MouseEvent | React.TouchEvent) => {
    if (e) e.preventDefault();
    isHoldingRef.current = false;
    setIsRecording(false);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      } catch (err) {
        console.error("Error stopping recorder", err);
      }
      mediaRecorderRef.current = null;
    }
  };

  return (
    <div className="relative flex flex-col items-center justify-center">
      <button 
        type="button"
        onMouseDown={(e) => { e.stopPropagation(); startRecording(e); }}
        onMouseUp={(e) => { e.stopPropagation(); stopRecording(e); }}
        onTouchStart={(e) => { e.stopPropagation(); startRecording(e); }}
        onTouchEnd={(e) => { e.stopPropagation(); stopRecording(e); }}
        onTouchCancel={(e) => { e.stopPropagation(); stopRecording(e); }}
        className={cn(
          "w-14 h-14 rounded-2xl flex items-center justify-center transition-all border-2 shadow-sm",
          isRecording 
            ? "bg-red-500 border-red-600 text-white scale-105 animate-pulse" 
            : "bg-indigo-50 border-indigo-100 text-indigo-600 hover:bg-indigo-100 active:scale-95",
          className
        )}
      >
        <Mic className={cn("w-6 h-6", isRecording && "animate-bounce")} />
      </button>
      {isRecording && (
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-red-500 text-white text-[10px] px-3 py-1.5 rounded-full whitespace-nowrap animate-bounce font-bold shadow-lg z-50">
          جاري التسجيل...
        </div>
      )}
      {error && (
        <span className="absolute -bottom-6 text-[10px] text-red-500 font-bold whitespace-nowrap">
          {error}
        </span>
      )}
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const customersRef = useRef<Customer[]>([]);

  useEffect(() => {
    customersRef.current = customers;
  }, [customers]);

  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    console.log("Search term changed:", searchTerm);
    if (searchTerm.length > 0) {
      // Try exact match first
      const exactMatch = customers.find(c => 
        normalizeArabic((c.name || '').toLowerCase()) === normalizeArabic(searchTerm.toLowerCase())
      );
      
      if (exactMatch) {
        setSelectedCustomer(exactMatch);
        setSearchTerm('');
        return;
      }

      // If search term is long enough, try partial match but only if it matches exactly ONE customer
      if (searchTerm.length >= 3) {
        const partialMatches = customers.filter(c => 
          normalizeArabic((c.name || '').toLowerCase()).includes(normalizeArabic(searchTerm.toLowerCase()))
        );
        if (partialMatches.length === 1) {
          setSelectedCustomer(partialMatches[0]);
          setSearchTerm('');
        }
      }
    }
  }, [searchTerm, customers]);
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false);
  const [isEditCustomerOpen, setIsEditCustomerOpen] = useState(false);
  const [isAddTransactionOpen, setIsAddTransactionOpen] = useState(false);
  const [isStatsVisible, setIsStatsVisible] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [transactionType, setTransactionType] = useState<'credit' | 'payment'>('credit');
  const [filterMonth, setFilterMonth] = useState<string>('all');
  const [filterYear, setFilterYear] = useState<string>('all');
  const [isSaving, setIsSaving] = useState(false);
  const [photoToView, setPhotoToView] = useState<string | null>(null);

  // Delete Modal States
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deletePasswordInput, setDeletePasswordInput] = useState('');
  const [deleteError, setDeleteError] = useState(false);

  // Login State
  const [loginError, setLoginError] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(false);

  // Form States
  const [customerVoice, setCustomerVoice] = useState<string | null>(null);
  const [autoExtractName, setAutoExtractName] = useState(true);
  const [customerPhoto, setCustomerPhoto] = useState<string | null>(null);
  const [customerGender, setCustomerGender] = useState<'male' | 'female'>('male');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [transactionAmount, setTransactionAmount] = useState('');
  const [isKeypadOpen, setIsKeypadOpen] = useState(false);
  const [transactionVoice, setTransactionVoice] = useState<string | null>(null);
  const [transactionPhoto, setTransactionPhoto] = useState<string | null>(null);
  const [isCompressingPhoto, setIsCompressingPhoto] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) setLoading(false);
    });
    
    // Safety timeout: if loading is still true after 5 seconds, force it to false
    // to allow the user to see the app (even if data is missing) or at least the login screen
    const timeout = setTimeout(() => {
      setLoading(false);
    }, 5000);

    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  // Online/Offline Listener
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Firebase Data Sync
  useEffect(() => {
    if (!user) return;

    const customersQuery = query(
      collection(db, 'customers'),
      where('ownerId', '==', user.uid)
    );
    const transactionsQuery = query(
      collection(db, 'transactions'),
      where('ownerId', '==', user.uid)
    );

    const unsubCustomers = onSnapshot(customersQuery, (snapshot) => {
      const data = snapshot.docs.map(doc => doc.data() as Customer);
      setCustomers(data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setLoading(false);
    }, (error) => {
      console.error("Customers snapshot error:", error);
      setLoading(false); // Ensure we stop loading even on error
      handleFirestoreError(error, OperationType.LIST, 'customers');
    });

    const unsubTransactions = onSnapshot(transactionsQuery, (snapshot) => {
      const data = snapshot.docs.map(doc => doc.data() as Transaction);
      setAllTransactions(data);
    }, (error) => {
      console.error("Transactions snapshot error:", error);
      handleFirestoreError(error, OperationType.LIST, 'transactions');
    });

    return () => {
      unsubCustomers();
      unsubTransactions();
    };
  }, [user]);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setIsLoadingAuth(true);

    try {
      if ((window as any).recaptchaVerifier) {
        try {
          (window as any).recaptchaVerifier.clear();
        } catch (e) {}
        (window as any).recaptchaVerifier = null;
      }
      
      const recaptchaContainer = document.getElementById('recaptcha-container');
      if (recaptchaContainer) {
        recaptchaContainer.innerHTML = '';
      }

      (window as any).recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible',
      });

      let formattedPhone = phoneNumber.trim();
      if (formattedPhone.startsWith('0')) {
        formattedPhone = '+212' + formattedPhone.substring(1);
      } else if (!formattedPhone.startsWith('+')) {
        formattedPhone = '+' + formattedPhone;
      }

      const confirmation = await signInWithPhoneNumber(auth, formattedPhone, (window as any).recaptchaVerifier);
      setConfirmationResult(confirmation);
      setIsOtpSent(true);
    } catch (error: any) {
      console.error("SMS error:", error);
      setLoginError("خطأ في إرسال الرمز: " + (error.message || error.code));
      if ((window as any).recaptchaVerifier) {
        (window as any).recaptchaVerifier.clear();
        (window as any).recaptchaVerifier = null;
      }
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmationResult) return;
    
    setLoginError('');
    setIsLoadingAuth(true);
    try {
      await confirmationResult.confirm(verificationCode);
    } catch (error: any) {
      console.error("OTP error:", error);
      setLoginError("الرمز غير صحيح أو منتهي الصلاحية");
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const handleLogin = async () => {
    setLoginError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error("Login error", error);
      if (error.code === 'auth/unauthorized-domain') {
        setLoginError("هذا النطاق غير مصرح به في Firebase. يرجى إضافة النطاق في إعدادات Authentication > Settings > Authorized domains.");
      } else if (error.code === 'auth/popup-closed-by-user') {
        // Silently handle popup closed by user
        console.log("User closed the popup.");
      } else if (error.code === 'auth/popup-blocked') {
        setLoginError("تم حظر نافذة الدخول (Popup Blocked). يرجى السماح بالنوافذ المنبثقة.");
      } else {
        setLoginError("خطأ في الدخول: " + (error.message || error.code));
      }
    }
  };

  const handleGuestLogin = async () => {
    setLoginError('');
    try {
      await signInAnonymously(auth);
    } catch (error: any) {
      console.error("Guest login error", error);
      if (error.code === 'auth/operation-not-allowed') {
        setLoginError("الدخول كضيف غير مفعل حالياً. يرجى تفعيله من إعدادات Firebase أو استخدام Google.");
      } else {
        setLoginError("وقع مشكل فالدخول كضيف: " + (error.message || error.code));
      }
    }
  };

  const handleLogoutClick = () => {
    setIsLogoutModalOpen(true);
  };

  const handleImportJson = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const importedCustomers = JSON.parse(e.target?.result as string);
        if (Array.isArray(importedCustomers)) {
          setIsSaving(true);
          const newCustomers: Customer[] = [];
          for (const c of importedCustomers) {
            const newCustomer: Customer = {
              ...c,
              id: generateId(),
              ownerId: user.uid,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            
            await setDoc(doc(db, 'customers', newCustomer.id), newCustomer);
            newCustomers.push(newCustomer);
          }
          setCustomers(prev => [...prev, ...newCustomers]);
          setIsSaving(false);
          alert('تم استيراد الكليان بنجاح');
        }
      } catch (error) {
        console.error("Error importing JSON", error);
        setIsSaving(false);
        alert('حدث خطأ أثناء استيراد الملف');
      }
    };
    reader.readAsText(file);
  };

  const confirmLogout = async () => {
    try {
      await signOut(auth);
      setCustomers([]);
      setAllTransactions([]);
      setSelectedCustomer(null);
      setIsLogoutModalOpen(false);
    } catch (error) {
      console.error("Logout error", error);
    }
  };

  const exportToJson = () => {
    const data = {
      customers: customers,
      transactions: allTransactions,
      exportedAt: new Date().toISOString()
    };
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `krediti_backup_${format(new Date(), 'yyyy-MM-dd')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportToPdf = () => {
    const doc = new jsPDF('p', 'pt', 'a4');
    
    doc.setFontSize(20);
    doc.text(`Monthly Report - ${format(new Date(), 'MMMM yyyy')}`, 40, 40);
    
    doc.setFontSize(12);
    doc.text(`Generated on: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`, 40, 60);

    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    
    const monthlyTransactions = allTransactions.filter(t => {
      const d = new Date(t.date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const tableData = monthlyTransactions.map(t => {
      const customer = customers.find(c => c.id === t.customerId);
      return [
        format(new Date(t.date), 'yyyy-MM-dd HH:mm'),
        customer ? (customer.name || 'Unknown') : 'Unknown',
        t.type === 'given' ? `-${t.amount} DH` : `+${t.amount} DH`,
        t.note || ''
      ];
    });

    (doc as any).autoTable({
      startY: 80,
      head: [['Date', 'Customer', 'Amount', 'Note']],
      body: tableData,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 10 },
      headStyles: { fillColor: [79, 70, 229] }
    });

    const totalGiven = monthlyTransactions.filter(t => t.type === 'given').reduce((sum, t) => sum + t.amount, 0);
    const totalReceived = monthlyTransactions.filter(t => t.type === 'received').reduce((sum, t) => sum + t.amount, 0);
    
    const finalY = (doc as any).lastAutoTable.finalY || 80;
    doc.text(`Total Given this month: ${totalGiven} DH`, 40, finalY + 30);
    doc.text(`Total Received this month: ${totalReceived} DH`, 40, finalY + 50);

    doc.save(`krediti_report_${format(new Date(), 'yyyy-MM')}.pdf`);
  };

  const transactions = useMemo(() => {
    if (!selectedCustomer) return [];
    let filtered = allTransactions.filter(t => t.customerId === selectedCustomer.id);
    
    if (filterMonth !== 'all') {
      filtered = filtered.filter(t => {
        const date = new Date(t.date);
        return (date.getMonth() + 1).toString() === filterMonth;
      });
    }
    
    if (filterYear !== 'all') {
      filtered = filtered.filter(t => {
        const date = new Date(t.date);
        return date.getFullYear().toString() === filterYear;
      });
    }

    return filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [allTransactions, selectedCustomer, filterMonth, filterYear]);

  const filteredCustomers = useMemo(() => {
    let filtered = customers.filter(c => 
      normalizeArabic((c.name || '').toLowerCase()).includes(normalizeArabic(searchTerm.toLowerCase()))
    );

    if (filterMonth !== 'all' || filterYear !== 'all') {
      const activeCustomerIds = new Set(
        allTransactions.filter(t => {
          const date = new Date(t.date);
          const monthMatch = filterMonth === 'all' || (date.getMonth() + 1).toString() === filterMonth;
          const yearMatch = filterYear === 'all' || date.getFullYear().toString() === filterYear;
          return monthMatch && yearMatch;
        }).map(t => t.customerId)
      );
      filtered = filtered.filter(c => activeCustomerIds.has(c.id));
    }

    return filtered;
  }, [customers, searchTerm, allTransactions, filterMonth, filterYear]);

  const stats = useMemo(() => {
    let totalCredit = 0;
    let totalDebt = 0;
    filteredCustomers.forEach(c => {
      if (c.totalBalance > 0) totalCredit += c.totalBalance;
      else totalDebt += Math.abs(c.totalBalance);
    });
    return { totalCredit, totalDebt };
  }, [filteredCustomers]);

  const compressImage = (file: File, maxWidth = 800, maxHeight = 800): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round(height * (maxWidth / width));
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round(width * (maxHeight / height));
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      
      img.onerror = (err) => {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      };
      
      img.src = objectUrl;
    });
  };

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        setIsCompressingPhoto(true);
        const compressed = await compressImage(file);
        const sizeInBytes = compressed.length * (3/4);
        console.log(`Compressed image size: ${(sizeInBytes / 1024).toFixed(2)} KB`);
        
        if (sizeInBytes > 800000) {
          alert("الصورة باقة كبيرة بزاف، جرب تصور شي حاجة أخرى أو نقص الجودة.");
          return;
        }
        setCustomerPhoto(compressed);
      } catch (error) {
        console.error("Error compressing image:", error);
        alert("وقع مشكل فاش بغينا نصغرو الصورة.");
      } finally {
        setIsCompressingPhoto(false);
      }
    }
    e.target.value = '';
  };

  const handleTransactionPhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        setIsCompressingPhoto(true);
        const compressed = await compressImage(file);
        const sizeInBytes = compressed.length * (3/4);
        if (sizeInBytes > 800000) {
          alert("الصورة باقة كبيرة بزاف، جرب تصور شي حاجة أخرى أو نقص الجودة.");
          return;
        }
        setTransactionPhoto(compressed);
      } catch (error) {
        console.error("Error compressing image:", error);
        alert("وقع مشكل فاش بغينا نصغرو الصورة.");
      } finally {
        setIsCompressingPhoto(false);
      }
    }
    e.target.value = '';
  };

  const handleAddCustomer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!user || isSaving) return;
    setIsSaving(true);
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const phone = formData.get('phone') as string;

    const newCustomer: any = {
      id: generateId(),
      customerNumber: Math.floor(100000 + Math.random() * 900000).toString(),
      name: customerName,
      phone: customerPhone,
      gender: customerGender,
      totalBalance: 0,
      ownerId: user.uid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (customerPhoto) newCustomer.photoBase64 = customerPhoto;
    if (customerVoice) newCustomer.voiceBase64 = customerVoice;

    try {
      await setDoc(doc(db, 'customers', newCustomer.id), newCustomer);
      setIsAddCustomerOpen(false);
      setCustomerPhoto(null);
      setCustomerVoice(null);
      setCustomerGender('male');
      setCustomerName('');
      setCustomerPhone('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `customers/${newCustomer.id}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditCustomer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingCustomer || !user || isSaving) return;
    setIsSaving(true);
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const phone = formData.get('phone') as string;

    const updatedCustomer: any = {
      ...editingCustomer,
      name: customerName,
      phone: customerPhone,
      gender: customerGender,
      updatedAt: new Date().toISOString()
    };

    if (customerPhoto) updatedCustomer.photoBase64 = customerPhoto;
    if (customerVoice) updatedCustomer.voiceBase64 = customerVoice;

    try {
      await setDoc(doc(db, 'customers', updatedCustomer.id), updatedCustomer);
      if (selectedCustomer?.id === editingCustomer.id) {
        setSelectedCustomer(updatedCustomer);
      }
      setIsEditCustomerOpen(false);
      setEditingCustomer(null);
      setCustomerPhoto(null);
      setCustomerVoice(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `customers/${updatedCustomer.id}`);
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (deletePasswordInput === "1988") {
      if (deleteTargetId && user) {
        try {
          const batch = writeBatch(db);
          
          // Delete customer
          batch.delete(doc(db, 'customers', deleteTargetId));
          
          // Delete associated transactions
          const customerTransactions = allTransactions.filter(t => t.customerId === deleteTargetId);
          customerTransactions.forEach(t => {
            batch.delete(doc(db, 'transactions', t.id));
          });
          
          await batch.commit();

          if (selectedCustomer?.id === deleteTargetId) {
            setSelectedCustomer(null);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `customers/${deleteTargetId}`);
        }
      }
      setIsDeleteModalOpen(false);
      setDeleteTargetId(null);
      setDeletePasswordInput('');
      setDeleteError(false);
    } else {
      setDeleteError(true);
      setTimeout(() => setDeleteError(false), 2000);
    }
  };

  const handleDeleteCustomer = (id: string) => {
    setDeleteTargetId(id);
    setIsDeleteModalOpen(true);
    setDeletePasswordInput('');
    setDeleteError(false);
  };

  const closeAddTransaction = () => {
    setIsAddTransactionOpen(false);
    setTransactionAmount('');
    setIsKeypadOpen(false);
    setTransactionVoice(null);
    setTransactionPhoto(null);
  };

  const handleAddTransaction = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedCustomer || !user || isSaving) return;
    setIsSaving(true);
    const formData = new FormData(e.currentTarget);
    const amount = parseFloat(transactionAmount);
    if (isNaN(amount) || amount <= 0) {
      alert("يرجى إدخال مبلغ صحيح");
      setIsSaving(false);
      return;
    }
    const type = formData.get('type') as 'credit' | 'payment';

    const newTransaction: any = {
      id: generateId(),
      customerId: selectedCustomer.id,
      amount,
      type,
      ownerId: user.uid,
      date: new Date().toISOString()
    };

    if (transactionVoice) newTransaction.voiceBase64 = transactionVoice;
    if (transactionPhoto) newTransaction.photoBase64 = transactionPhoto;

    const balanceChange = type === 'credit' ? amount : -amount;
    const updatedCustomer = {
      ...selectedCustomer,
      totalBalance: selectedCustomer.totalBalance + balanceChange,
      updatedAt: new Date().toISOString()
    };

    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'transactions', newTransaction.id), newTransaction);
      batch.set(doc(db, 'customers', selectedCustomer.id), updatedCustomer);
      await batch.commit();

      setSelectedCustomer(updatedCustomer);
      closeAddTransaction();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'batch/transaction-customer');
    } finally {
      setIsSaving(false);
    }
  };

  if (!user && !loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-indigo-600 p-6">
        <div className="bg-white w-full max-w-sm rounded-[3rem] p-10 text-center shadow-2xl">
          <div className="w-32 h-32 mx-auto mb-8 bg-white rounded-[2.5rem] shadow-2xl flex items-center justify-center border-4 border-indigo-50">
            <Logo className="w-24 h-24" />
          </div>
          <h1 className="text-4xl font-black mb-4 text-gray-900">Krediti</h1>
          <p className="text-gray-500 font-bold mb-10 text-lg">سجل ديونك وحساباتك بكل سهولة وأمان</p>
          
          {loginError && (
            <div className="mb-6 p-4 bg-red-50 border-2 border-red-100 rounded-2xl">
              <p className="text-red-600 font-bold text-sm leading-relaxed">{loginError}</p>
            </div>
          )}

          <div className="mb-6">
            {!isOtpSent ? (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <input 
                    type="tel"
                    placeholder="رقم الهاتف (مثال: 0612345678)"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl font-bold text-lg outline-none focus:border-indigo-500 transition-all text-center"
                    dir="ltr"
                    required
                  />
                </div>
                <button 
                  type="submit"
                  disabled={isLoadingAuth || !phoneNumber}
                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-lg shadow-xl shadow-indigo-100 active:scale-95 transition-all disabled:opacity-50"
                >
                  {isLoadingAuth ? 'جاري الإرسال...' : 'الدخول برقم الهاتف'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div>
                  <input 
                    type="text"
                    placeholder="أدخل الرمز السري (OTP)"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    className="w-full px-6 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl font-bold text-lg outline-none focus:border-indigo-500 transition-all text-center tracking-widest"
                    dir="ltr"
                    required
                  />
                </div>
                <button 
                  type="submit"
                  disabled={isLoadingAuth || !verificationCode}
                  className="w-full py-4 bg-green-600 text-white rounded-2xl font-black text-lg shadow-xl shadow-green-100 active:scale-95 transition-all disabled:opacity-50"
                >
                  {isLoadingAuth ? 'جاري التحقق...' : 'تأكيد الدخول'}
                </button>
                <button 
                  type="button"
                  onClick={() => {
                    setIsOtpSent(false);
                    if ((window as any).recaptchaVerifier) {
                      try {
                        (window as any).recaptchaVerifier.clear();
                      } catch (e) {}
                      (window as any).recaptchaVerifier = null;
                    }
                  }}
                  className="w-full py-2 text-gray-500 font-bold text-sm hover:text-gray-700"
                >
                  تغيير رقم الهاتف
                </button>
              </form>
            )}
          </div>
          
          <div className="relative flex items-center py-4 mb-4">
            <div className="flex-grow border-t border-gray-200"></div>
            <span className="flex-shrink-0 mx-4 text-gray-400 font-bold text-sm">أو</span>
            <div className="flex-grow border-t border-gray-200"></div>
          </div>

          <button 
            onClick={handleLogin}
            className="w-full py-4 bg-white border-2 border-gray-100 text-gray-700 rounded-2xl font-black text-lg shadow-sm flex items-center justify-center gap-4 active:scale-95 transition-all mb-4 hover:bg-gray-50"
          >
            <img src="https://www.google.com/favicon.ico" className="w-6 h-6" alt="" />
            دخول بـ Google
          </button>

          <button 
            onClick={handleGuestLogin}
            className="w-full py-4 bg-gray-100 text-gray-600 rounded-2xl font-black text-lg flex items-center justify-center gap-4 active:scale-95 transition-all hover:bg-gray-200"
          >
            <UserIcon className="w-6 h-6" />
            الدخول كضيف (بدون حساب)
          </button>

          <div id="recaptcha-container"></div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-indigo-600">
        <div className="text-center p-6">
          <Logo className="w-16 h-16 mx-auto mb-4 animate-bounce" />
          <p className="text-white font-bold text-xl mb-2">جاري التحميل...</p>
          <p className="text-indigo-200 text-sm mb-6">كنحاولوا نتصلوا بقاعدة البيانات</p>
          
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-white text-indigo-600 rounded-2xl font-black shadow-lg hover:bg-indigo-50 transition-colors"
          >
            إعادة المحاولة
          </button>
          
          {user && (
            <button 
              onClick={() => signOut(auth)}
              className="block mt-4 text-indigo-200 text-xs hover:text-white transition-colors mx-auto"
            >
              تسجيل الخروج
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900 pb-24">
      {/* Header */}
      <header className="bg-indigo-600 text-white px-6 py-6 sticky top-0 z-10 shadow-lg">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo className="w-10 h-10 bg-white rounded-xl p-1 shadow-inner" />
            <h1 className="text-2xl font-black tracking-tight">Krediti</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-full">
              {isOnline ? (
                <Wifi className="w-4 h-4 text-green-400" />
              ) : (
                <WifiOff className="w-4 h-4 text-red-400" />
              )}
              <span className="text-[10px] font-black uppercase tracking-widest">
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
            <button
              onClick={() => setPendingAction('settings')}
              className="p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
            >
              <Settings className="w-6 h-6" />
            </button>
            
            <div className="flex gap-2">
              <button 
                onClick={exportToJson}
                className="w-10 h-10 bg-white/20 text-white rounded-full flex items-center justify-center hover:bg-white/30 transition-colors"
                title="تصدير JSON"
              >
                <FileJson className="w-5 h-5" />
              </button>
              <button 
                onClick={exportToPdf}
                className="w-10 h-10 bg-white/20 text-white rounded-full flex items-center justify-center hover:bg-white/30 transition-colors"
                title="تصدير تقرير PDF"
              >
                <FileText className="w-5 h-5" />
              </button>
            </div>

            <button 
              onClick={handleLogoutClick}
              className="w-10 h-10 bg-white/20 text-white rounded-full flex items-center justify-center hover:bg-white/30 transition-colors"
              title="تسجيل الخروج"
            >
              <LogOut className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setIsStatsVisible(!isStatsVisible)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-black transition-all",
                isStatsVisible ? "bg-white text-indigo-600" : "bg-white/20 text-white"
              )}
            >
              <Database className="w-4 h-4" />
              <span>الحسابات</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 space-y-6">
        {/* Stats Section (Special Place) */}
        {isStatsVisible && !selectedCustomer && (
          <div className="space-y-4 animate-in slide-in-from-top duration-300">
            <div className="grid grid-cols-1 gap-4">
              <div className="bg-white p-6 rounded-[2rem] shadow-xl border-l-8 border-green-500 flex items-center justify-between">
                <div>
                  <p className="text-green-600 font-black text-sm mb-1 uppercase tracking-wider">كاتسال (فلوسك)</p>
                  <p className="text-3xl font-black text-gray-900">
                    {stats.totalCredit.toLocaleString()} <span className="text-lg font-normal text-gray-400">DH</span>
                  </p>
                </div>
                <div className="w-14 h-14 bg-green-50 text-green-600 rounded-2xl flex items-center justify-center">
                  <TrendingUp className="w-8 h-8" />
                </div>
              </div>
              <div className="bg-white p-6 rounded-[2rem] shadow-xl border-l-8 border-red-500 flex items-center justify-between">
                <div>
                  <p className="text-red-600 font-black text-sm mb-1 uppercase tracking-wider">كايسالوك (ديون)</p>
                  <p className="text-3xl font-black text-gray-900">
                    {stats.totalDebt.toLocaleString()} <span className="text-lg font-normal text-gray-400">DH</span>
                  </p>
                </div>
                <div className="w-14 h-14 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center">
                  <TrendingDown className="w-8 h-8" />
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedCustomer ? (
          /* Customer Detail View */
          <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300">
            <button 
              onClick={() => setSelectedCustomer(null)}
              className="flex items-center gap-2 text-indigo-600 font-black text-lg bg-white px-4 py-3 rounded-2xl shadow-sm border border-indigo-100 hover:bg-indigo-50 transition-colors"
            >
              <Home className="w-6 h-6" />
              <span>الرئيسية</span>
            </button>

            <div className={cn(
              "p-6 rounded-[2.5rem] shadow-xl border flex flex-col items-center text-center gap-4 relative",
              selectedCustomer.gender === 'male' ? "bg-blue-50 border-blue-100" : "bg-pink-50 border-pink-100"
            )}>
              <div className="absolute top-6 right-6 flex gap-2">
                <button 
                  onClick={() => {
                    setEditingCustomer(selectedCustomer);
                    setCustomerName(selectedCustomer.name || '');
                    setCustomerPhone(selectedCustomer.phone || '');
                    setCustomerGender(selectedCustomer.gender);
                    setCustomerPhoto(null);
                    setCustomerVoice(null);
                    setIsEditCustomerOpen(true);
                  }}
                  className="w-10 h-10 bg-white/60 text-gray-600 rounded-full flex items-center justify-center hover:bg-white transition-colors"
                >
                  <Edit className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => handleDeleteCustomer(selectedCustomer.id)}
                  className="w-10 h-10 bg-red-100 text-red-600 rounded-full flex items-center justify-center hover:bg-red-200 transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>

              {selectedCustomer.customerNumber && (
                <div className="absolute top-6 left-6 px-3 py-1.5 rounded-xl text-sm font-black tracking-wider bg-white/60 text-gray-600">
                  #{selectedCustomer.customerNumber}
                </div>
              )}

              <div className="relative">
                {selectedCustomer.photoBase64 ? (
                  <img 
                    src={selectedCustomer.photoBase64} 
                    className="w-32 h-32 rounded-full object-cover border-4 border-indigo-100 shadow-lg cursor-pointer hover:opacity-90 transition-opacity" 
                    alt="" 
                    onClick={() => setPhotoToView(selectedCustomer.photoBase64!)}
                  />
                ) : (
                  <div className="w-32 h-32 bg-indigo-50 rounded-full flex items-center justify-center border-4 border-indigo-100 shadow-lg">
                    <UserIcon className="w-16 h-16 text-indigo-200" />
                  </div>
                )}
                {selectedCustomer.voiceBase64 && (
                  <div className="absolute -bottom-2 -right-2">
                    <AudioPlayer base64={selectedCustomer.voiceBase64} />
                  </div>
                )}
              </div>
              
              <div>
                <h2 className="text-3xl font-black text-gray-900">{selectedCustomer.name || 'بدون اسم'}</h2>
                
                <div className="flex items-center justify-center gap-4 mt-4">
                  {selectedCustomer.phone && (
                    <>
                      <a 
                        href={`tel:${selectedCustomer.phone}`}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-xl font-bold hover:bg-blue-100 transition-colors"
                      >
                        <Phone className="w-4 h-4" />
                        <span>اتصال</span>
                      </a>
                      <a 
                        href={`https://wa.me/${selectedCustomer.phone.replace(/\s/g, '').startsWith('0') ? '212' + selectedCustomer.phone.replace(/\s/g, '').substring(1) : selectedCustomer.phone.replace(/\s/g, '').replace('+', '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-600 rounded-xl font-bold hover:bg-green-100 transition-colors"
                      >
                        <MessageCircle className="w-4 h-4" />
                        <span>واتساب</span>
                      </a>
                    </>
                  )}
                </div>

                <div className="flex items-center justify-center gap-2 mt-4">
                  {selectedCustomer.totalBalance > 500 ? (
                    <span className="text-4xl" title="دين كبير">⚠️</span>
                  ) : selectedCustomer.totalBalance > 0 ? (
                    <span className="text-4xl" title="دين متوسط">📉</span>
                  ) : selectedCustomer.totalBalance < 0 ? (
                    <span className="text-4xl" title="خالص">💰</span>
                  ) : (
                    <span className="text-4xl" title="جديد">🤝</span>
                  )}
                </div>
                <div className={cn(
                  "mt-4 px-8 py-4 rounded-3xl inline-block",
                  selectedCustomer.totalBalance >= 0 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                )}>
                  <p className="text-sm font-bold uppercase tracking-widest mb-1">
                    {selectedCustomer.totalBalance >= 0 ? "كاتسالو" : "كايسالك"}
                  </p>
                  <p className="text-4xl font-black">
                    {Math.abs(selectedCustomer.totalBalance).toLocaleString()} <span className="text-xl font-normal">DH</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => { setTransactionType('credit'); setIsAddTransactionOpen(true); }}
                className="bg-green-600 text-white p-6 rounded-[2rem] shadow-lg shadow-green-100 flex flex-col items-center gap-2 active:scale-95 transition-all"
              >
                <TrendingUp className="w-10 h-10" />
                <span className="font-black text-xl">خدا كريدي</span>
              </button>
              <button 
                onClick={() => { setTransactionType('payment'); setIsAddTransactionOpen(true); }}
                className="bg-red-600 text-white p-6 rounded-[2rem] shadow-lg shadow-red-100 flex flex-col items-center gap-2 active:scale-95 transition-all"
              >
                <TrendingDown className="w-10 h-10" />
                <span className="font-black text-xl">خلصني</span>
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-xl font-black">آخر العمليات</h3>
                <div className="flex gap-2">
                  <select 
                    value={filterMonth}
                    onChange={(e) => setFilterMonth(e.target.value)}
                    className="bg-gray-100 border-none rounded-xl text-xs font-bold px-2 py-1 outline-none"
                  >
                    <option value="all">جميع الشهور</option>
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i + 1} value={(i + 1).toString()}>
                        {format(new Date(2024, i, 1), 'MMMM')}
                      </option>
                    ))}
                  </select>
                  <select 
                    value={filterYear}
                    onChange={(e) => setFilterYear(e.target.value)}
                    className="bg-gray-100 border-none rounded-xl text-xs font-bold px-2 py-1 outline-none"
                  >
                    <option value="all">جميع السنوات</option>
                    {[2024, 2025, 2026].map(y => (
                      <option key={y} value={y.toString()}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
              {transactions.length === 0 ? (
                <div className="bg-white p-10 rounded-3xl border border-dashed border-gray-200 text-center">
                  <p className="text-gray-400 font-bold">حتى عملية فهاد التاريخ</p>
                </div>
              ) : (
                transactions.map(t => (
                  <div key={t.id} className="bg-white p-5 rounded-3xl border border-gray-100 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-14 h-14 rounded-2xl flex items-center justify-center",
                        t.type === 'credit' ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                      )}>
                        {t.type === 'credit' ? <TrendingUp className="w-8 h-8" /> : <TrendingDown className="w-8 h-8" />}
                      </div>
                      <div>
                        <p className="font-black text-lg">{t.type === 'credit' ? 'خدا سلعة' : 'عطاني فلوس'}</p>
                        <p className="text-xs text-gray-400 font-bold">{format(new Date(t.date), 'dd/MM/yyyy HH:mm')}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {t.photoBase64 && (
                        <img 
                          src={t.photoBase64} 
                          alt="Transaction" 
                          className="w-12 h-12 object-cover rounded-xl border border-gray-200 cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => setPhotoToView(t.photoBase64!)}
                        />
                      )}
                      {t.voiceBase64 && <AudioPlayer base64={t.voiceBase64} />}
                      <p className={cn(
                        "text-xl font-black",
                        t.type === 'credit' ? "text-green-600" : "text-red-600"
                      )}>
                        {t.amount.toLocaleString()} DH
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          /* Dashboard View */
          <div className="space-y-8 animate-in fade-in duration-500">
            {/* Search */}
            <div className="flex flex-col gap-4">
              <div className="relative flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-400" />
                  <input 
                    type="text" 
                    placeholder="قلب على كليان..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-14 pr-6 py-6 bg-white border-2 border-indigo-50 rounded-3xl text-xl font-bold focus:outline-none focus:border-indigo-500 transition-all shadow-sm"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <select 
                  value={filterMonth}
                  onChange={(e) => setFilterMonth(e.target.value)}
                  className="flex-1 bg-white border-2 border-indigo-50 rounded-2xl text-sm font-bold px-4 py-3 outline-none focus:border-indigo-500"
                >
                  <option value="all">جميع الشهور</option>
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i + 1} value={(i + 1).toString()}>
                      {format(new Date(2024, i, 1), 'MMMM')}
                    </option>
                  ))}
                </select>
                <select 
                  value={filterYear}
                  onChange={(e) => setFilterYear(e.target.value)}
                  className="flex-1 bg-white border-2 border-indigo-50 rounded-2xl text-sm font-bold px-4 py-3 outline-none focus:border-indigo-500"
                >
                  <option value="all">جميع السنوات</option>
                  {[2024, 2025, 2026].map(y => (
                    <option key={y} value={y.toString()}>{y}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Customer List */}
            <div className="space-y-4">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-xl font-black text-gray-400 uppercase tracking-widest">الكليان ديالي</h3>
                <span className="bg-indigo-100 text-indigo-600 px-3 py-1 rounded-full text-sm font-black">{customers.length}</span>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                {filteredCustomers.map(c => {
                  const daysSince = getDaysSince(c.updatedAt);
                  return (
                    <div 
                      key={c.id}
                      className={cn(
                        "w-full p-6 rounded-[2.5rem] border-2 flex flex-col items-center text-center hover:shadow-2xl transition-all group relative",
                        c.gender === 'male' ? "bg-blue-50 border-blue-100 hover:border-blue-300" : "bg-pink-50 border-pink-100 hover:border-pink-300"
                      )}
                    >
                      <button 
                        onClick={() => setSelectedCustomer(c)}
                        className="absolute inset-0 w-full h-full z-0 rounded-[2rem] active:scale-[0.98] transition-transform"
                      />
                      
                      <div className={cn(
                        "absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-xs font-black z-10",
                        c.gender === 'male' ? "bg-blue-100 text-blue-600" : "bg-pink-100 text-pink-600"
                      )}>
                        {daysSince}
                      </div>

                      {c.customerNumber && (
                        <div className="absolute top-3 left-3 px-3 py-1 rounded-xl text-xs font-black tracking-wider z-20 bg-indigo-600 text-white shadow-lg">
                          #{c.customerNumber}
                        </div>
                      )}
                      
                      <div className="relative mb-3 z-10 pointer-events-none">
                        {c.photoBase64 ? (
                          <img 
                            src={c.photoBase64} 
                            className={cn(
                              "w-20 h-20 rounded-2xl object-cover shadow-md border-2 pointer-events-auto cursor-pointer hover:opacity-90 transition-opacity",
                              c.gender === 'male' ? "border-blue-200" : "border-pink-200"
                            )} 
                            alt="" 
                            onClick={(e) => {
                              e.stopPropagation();
                              setPhotoToView(c.photoBase64!);
                            }}
                          />
                        ) : (
                          <div className={cn(
                            "w-20 h-20 rounded-2xl flex items-center justify-center",
                            c.gender === 'male' ? "bg-blue-100 text-blue-300" : "bg-pink-100 text-pink-300"
                          )}>
                            <UserIcon className="w-10 h-10" />
                          </div>
                        )}
                        {c.voiceBase64 && (
                          <div className="absolute -bottom-2 -right-2 pointer-events-auto">
                            <AudioPlayer base64={c.voiceBase64} />
                          </div>
                        )}
                      </div>
                      
                      <div className="w-full z-10 pointer-events-none mt-4">
                        <p className="font-black text-xl text-gray-900 truncate px-1">{c.name || 'بدون اسم'}</p>
                        <p className={cn(
                          "text-2xl font-black mt-2",
                          c.totalBalance >= 0 ? "text-green-600" : "text-red-600"
                        )}>
                          {Math.abs(c.totalBalance).toLocaleString()} <span className="text-sm font-normal">DH</span>
                        </p>
                        <p className="text-[11px] font-black text-gray-500 uppercase tracking-wider mt-1">
                          {c.totalBalance >= 0 ? "كاتسالو" : "كايسالك"}
                        </p>
                      </div>

                      {c.phone && (
                        <div className="flex items-center justify-center gap-2 mt-4 w-full z-10">
                          <a 
                            href={`tel:${c.phone}`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 flex items-center justify-center gap-2 py-2 bg-white/60 text-blue-600 rounded-xl font-bold hover:bg-white transition-colors text-sm"
                          >
                            <Phone className="w-4 h-4" />
                            <span>اتصال</span>
                          </a>
                          <a 
                            href={`https://wa.me/${c.phone.replace(/\s/g, '').startsWith('0') ? '212' + c.phone.replace(/\s/g, '').substring(1) : c.phone.replace(/\s/g, '').replace('+', '')}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 flex items-center justify-center gap-2 py-2 bg-white/60 text-green-600 rounded-xl font-bold hover:bg-white transition-colors text-sm"
                          >
                            <MessageCircle className="w-4 h-4" />
                            <span>واتساب</span>
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Floating Action Button */}
      {!selectedCustomer && (
        <button 
          onClick={() => {
            setCustomerName('');
            setCustomerPhone('');
            setIsAddCustomerOpen(true);
          }}
          className="fixed bottom-8 right-8 px-6 py-6 bg-indigo-600 text-white rounded-3xl shadow-2xl shadow-indigo-300 flex items-center gap-3 active:scale-90 transition-all z-20 border-4 border-white"
        >
          <UserPlus className="w-10 h-10" />
          <span className="font-black text-xl">كليان جديد</span>
        </button>
      )}

      {/* Modals */}
      {isAddCustomerOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-end md:items-center justify-center p-0 md:p-4">
          <div className="bg-white w-full max-w-md rounded-t-[3rem] md:rounded-[3rem] p-8 animate-in slide-in-from-bottom-full duration-300">
            <h2 className="text-3xl font-black mb-8 text-center">كليان جديد</h2>
            <form onSubmit={handleAddCustomer} className="space-y-6">
              <div className="flex justify-center gap-6 mb-8">
                <div className="relative">
                  <label className={cn("cursor-pointer", isCompressingPhoto && "opacity-50 pointer-events-none")}>
                    <input type="file" accept="image/jpeg, image/png, image/webp" onChange={handlePhotoCapture} className="hidden" disabled={isCompressingPhoto} />
                    <div className={cn(
                      "w-32 h-32 rounded-3xl flex flex-col items-center justify-center border-4 border-dashed transition-all relative overflow-hidden",
                      customerPhoto ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-gray-50"
                    )}>
                      {isCompressingPhoto ? (
                        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                      ) : customerPhoto ? (
                        <img 
                          src={customerPhoto} 
                          className="w-full h-full object-cover rounded-2xl cursor-pointer hover:opacity-90 transition-opacity" 
                          alt="" 
                          onClick={(e) => {
                            e.preventDefault();
                            setPhotoToView(customerPhoto);
                          }}
                        />
                      ) : (
                        <>
                          <Camera className="w-10 h-10 text-gray-300 mb-1" />
                          <span className="text-[10px] font-black text-gray-400">صور الكليان</span>
                        </>
                      )}
                    </div>
                  </label>
                </div>
                <div className="w-32 h-32 flex flex-col items-center justify-center">
                  <VoiceButton onRecordingComplete={setCustomerVoice} />
                  {customerVoice && (
                    <div className="mt-2 flex flex-col items-center gap-1">
                      <p className="text-green-600 font-bold text-[10px]">تم التسجيل ✅</p>
                      <AudioPlayer base64={customerVoice} label="اسمع" />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <label className="block text-lg font-black text-gray-700 text-center">الجنس (اللون)</label>
                <div className="grid grid-cols-2 gap-4">
                  <button 
                    type="button"
                    onClick={() => setCustomerGender('male')}
                    className={cn(
                      "py-4 rounded-2xl font-black text-lg border-4 transition-all",
                      customerGender === 'male' ? "bg-blue-500 text-white border-blue-600 shadow-lg" : "bg-blue-50 text-blue-500 border-blue-100"
                    )}
                  >
                    رجل (أزرق)
                  </button>
                  <button 
                    type="button"
                    onClick={() => setCustomerGender('female')}
                    className={cn(
                      "py-4 rounded-2xl font-black text-lg border-4 transition-all",
                      customerGender === 'female' ? "bg-pink-500 text-white border-pink-600 shadow-lg" : "bg-pink-50 text-pink-500 border-pink-100"
                    )}
                  >
                    امرأة (وردي)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-lg font-black text-gray-700 mb-2">السمية (اختياري)</label>
                  <div className="flex gap-2 relative">
                    <input 
                      name="name" 
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="flex-1 px-6 py-5 bg-gray-50 border-2 border-gray-100 rounded-2xl text-xl font-bold focus:border-indigo-500 outline-none transition-all"
                      placeholder=""
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-lg font-black text-gray-700 mb-2">رقم الهاتف (اختياري)</label>
                  <input 
                    name="phone" 
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full px-6 py-5 bg-gray-50 border-2 border-gray-100 rounded-2xl text-xl font-bold focus:border-indigo-500 outline-none"
                    placeholder=""
                  />
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={() => setIsAddCustomerOpen(false)}
                  className="flex-1 py-5 bg-gray-100 text-gray-600 rounded-3xl font-black text-xl hover:bg-gray-200 transition-colors"
                >
                  إلغاء
                </button>
                <button 
                  type="submit"
                  disabled={isSaving}
                  className={cn(
                    "flex-1 py-5 bg-indigo-600 text-white rounded-3xl font-black text-xl hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100",
                    isSaving && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {isSaving ? "جاري الحفظ..." : "حفظ"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isAddTransactionOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-end md:items-center justify-center p-0 md:p-4">
          <div className="bg-white w-full max-w-md rounded-t-[3rem] md:rounded-[3rem] p-8 animate-in slide-in-from-bottom-full duration-300">
            <h2 className="text-3xl font-black mb-8 text-center">عملية جديدة</h2>
            <form onSubmit={handleAddTransaction} className="space-y-6">
              <div>
                <label className="block text-lg font-black text-gray-700 mb-4 text-center">شنو وقع؟</label>
                <div className="grid grid-cols-2 gap-4">
                  <label className="relative cursor-pointer">
                    <input 
                      type="radio" 
                      name="type" 
                      value="credit" 
                      checked={transactionType === 'credit'} 
                      onChange={() => setTransactionType('credit')}
                      className="peer sr-only" 
                    />
                    <div className="p-6 border-4 border-gray-100 rounded-[2rem] text-center peer-checked:border-green-600 peer-checked:bg-green-50 transition-all">
                      <TrendingUp className="w-10 h-10 mx-auto mb-2 text-green-600" />
                      <span className="font-black text-lg">خدا سلعة</span>
                    </div>
                  </label>
                  <label className="relative cursor-pointer">
                    <input 
                      type="radio" 
                      name="type" 
                      value="payment" 
                      checked={transactionType === 'payment'} 
                      onChange={() => setTransactionType('payment')}
                      className="peer sr-only" 
                    />
                    <div className="p-6 border-4 border-gray-100 rounded-[2rem] text-center peer-checked:border-red-600 peer-checked:bg-red-50 transition-all">
                      <TrendingDown className="w-10 h-10 mx-auto mb-2 text-red-600" />
                      <span className="font-black text-lg">عطاني فلوس</span>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-lg font-black text-gray-700 mb-2">شحال؟ (DH)</label>
                <input 
                  name="amount" 
                  type="text"
                  readOnly
                  value={transactionAmount}
                  onClick={() => setIsKeypadOpen(true)}
                  required 
                  className="w-full px-6 py-6 bg-gray-50 border-2 border-gray-100 rounded-3xl text-4xl font-black text-center focus:border-indigo-500 outline-none cursor-pointer"
                  placeholder="0"
                />
              </div>

              {isKeypadOpen && (
                <NumericKeypad 
                  value={transactionAmount}
                  onKeyPress={(key) => setTransactionAmount(prev => prev + key)}
                  onBackspace={() => setTransactionAmount(prev => prev.slice(0, -1))}
                  onClose={() => setIsKeypadOpen(false)}
                />
              )}

              <div className="space-y-2 flex flex-col items-center">
                <label className="block text-lg font-black text-gray-700 mb-2">سجل شنو خدا (بالصوت)</label>
                <VoiceButton onRecordingComplete={setTransactionVoice} />
                {transactionVoice && (
                  <div className="mt-2 flex flex-col items-center gap-1">
                    <p className="text-green-600 font-bold text-[10px]">تم التسجيل ✅</p>
                    <AudioPlayer base64={transactionVoice} label="اسمع" />
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-lg font-black text-gray-700 mb-2">صورة (اختياري)</label>
                <div className="flex items-center justify-center w-full">
                  <label className={cn("flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-gray-300 rounded-3xl cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors", isCompressingPhoto && "opacity-50 pointer-events-none")}>
                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                      {isCompressingPhoto ? (
                        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-2" />
                      ) : (
                        <Camera className="w-8 h-8 text-gray-400 mb-2" />
                      )}
                      <p className="text-sm text-gray-500 font-bold">
                        {isCompressingPhoto ? "جاري معالجة الصورة..." : "صور السلعة أو البون"}
                      </p>
                    </div>
                    <input type="file" accept="image/jpeg, image/png, image/webp" className="hidden" onChange={handleTransactionPhotoCapture} disabled={isCompressingPhoto} />
                  </label>
                </div>
                {transactionPhoto && !isCompressingPhoto && (
                  <div className="mt-2 flex justify-center">
                    <img 
                      src={transactionPhoto} 
                      alt="Transaction" 
                      className="w-24 h-24 object-cover rounded-2xl border-2 border-indigo-100 shadow-sm cursor-pointer hover:opacity-90 transition-opacity" 
                      onClick={(e) => {
                        e.preventDefault();
                        setPhotoToView(transactionPhoto);
                      }}
                    />
                  </div>
                )}
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={closeAddTransaction}
                  className="flex-1 py-5 bg-gray-100 text-gray-600 rounded-3xl font-black text-xl"
                >
                  إلغاء
                </button>
                <button 
                  type="submit"
                  disabled={isSaving || isCompressingPhoto}
                  className={cn(
                    "flex-1 py-5 bg-indigo-600 text-white rounded-3xl font-black text-xl shadow-xl shadow-indigo-100 transition-all",
                    (isSaving || isCompressingPhoto) && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {isSaving ? "جاري الحفظ..." : "تأكيد"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {isEditCustomerOpen && editingCustomer && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-end md:items-center justify-center p-0 md:p-4">
          <div className="bg-white w-full max-w-md rounded-t-[3rem] md:rounded-[3rem] p-8 animate-in slide-in-from-bottom-full duration-300">
            <h2 className="text-3xl font-black mb-8 text-center">تعديل الكليان</h2>
            <form onSubmit={handleEditCustomer} className="space-y-6">
              <div className="flex justify-center gap-6 mb-8">
                <div className="relative">
                  <label className={cn("cursor-pointer", isCompressingPhoto && "opacity-50 pointer-events-none")}>
                    <input type="file" accept="image/jpeg, image/png, image/webp" onChange={handlePhotoCapture} className="hidden" disabled={isCompressingPhoto} />
                    <div className={cn(
                      "w-32 h-32 rounded-3xl flex flex-col items-center justify-center border-4 border-dashed transition-all relative overflow-hidden",
                      (customerPhoto || editingCustomer.photoBase64) ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-gray-50"
                    )}>
                      {isCompressingPhoto ? (
                        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                      ) : (customerPhoto || editingCustomer.photoBase64) ? (
                        <img 
                          src={customerPhoto || editingCustomer.photoBase64} 
                          className="w-full h-full object-cover rounded-2xl cursor-pointer hover:opacity-90 transition-opacity" 
                          alt="" 
                          onClick={(e) => {
                            e.preventDefault();
                            setPhotoToView(customerPhoto || editingCustomer.photoBase64!);
                          }}
                        />
                      ) : (
                        <>
                          <Camera className="w-10 h-10 text-gray-300 mb-1" />
                          <span className="text-[10px] font-black text-gray-400">تغيير الصورة</span>
                        </>
                      )}
                    </div>
                  </label>
                </div>
                <div className="w-32 h-32 flex flex-col items-center justify-center">
                  <VoiceButton onRecordingComplete={setCustomerVoice} />
                  {(customerVoice || editingCustomer.voiceBase64) && (
                    <div className="mt-2 flex flex-col items-center gap-1">
                      <p className="text-green-600 font-bold text-[10px]">صوت مسجل ✅</p>
                      <AudioPlayer base64={customerVoice || editingCustomer.voiceBase64 || ''} label="اسمع" />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <label className="block text-lg font-black text-gray-700 text-center">الجنس (اللون)</label>
                <div className="grid grid-cols-2 gap-4">
                  <button 
                    type="button"
                    onClick={() => setCustomerGender('male')}
                    className={cn(
                      "py-4 rounded-2xl font-black text-lg border-4 transition-all",
                      customerGender === 'male' ? "bg-blue-500 text-white border-blue-600 shadow-lg" : "bg-blue-50 text-blue-500 border-blue-100"
                    )}
                  >
                    رجل (أزرق)
                  </button>
                  <button 
                    type="button"
                    onClick={() => setCustomerGender('female')}
                    className={cn(
                      "py-4 rounded-2xl font-black text-lg border-4 transition-all",
                      customerGender === 'female' ? "bg-pink-500 text-white border-pink-600 shadow-lg" : "bg-pink-50 text-pink-500 border-pink-100"
                    )}
                  >
                    امرأة (وردي)
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-lg font-black text-gray-700 mb-2">السمية</label>
                  <div className="flex gap-2 relative">
                    <input 
                      name="name" 
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="flex-1 px-6 py-5 bg-gray-50 border-2 border-gray-100 rounded-2xl text-xl font-bold focus:border-indigo-500 outline-none transition-all"
                      placeholder=""
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-lg font-black text-gray-700 mb-2">رقم الهاتف</label>
                  <input 
                    name="phone" 
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    className="w-full px-6 py-5 bg-gray-50 border-2 border-gray-100 rounded-2xl text-xl font-bold focus:border-indigo-500 outline-none"
                    placeholder=""
                  />
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={() => {
                    setIsEditCustomerOpen(false);
                    setEditingCustomer(null);
                  }}
                  className="flex-1 py-5 bg-gray-100 text-gray-600 rounded-3xl font-black text-xl"
                >
                  إلغاء
                </button>
                <button 
                  type="submit"
                  disabled={isSaving}
                  className={cn(
                    "flex-1 py-5 bg-indigo-600 text-white rounded-3xl font-black text-xl shadow-xl shadow-indigo-100 transition-all",
                    isSaving && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {isSaving ? "جاري الحفظ..." : "تحديث"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-[3rem] p-8 animate-in zoom-in-95 duration-200">
            <h2 className="text-2xl font-black mb-6 text-center">الإعدادات</h2>
            <div className="space-y-4">
              <button 
                onClick={() => setPendingAction('exportJson')}
                className="w-full flex items-center gap-4 p-4 bg-gray-50 rounded-2xl font-bold hover:bg-gray-100 transition-colors"
              >
                <FileJson className="w-6 h-6 text-indigo-600" />
                تصدير البيانات (JSON)
              </button>
              <button 
                onClick={() => document.getElementById('import-json-settings')?.click()}
                className="w-full flex items-center gap-4 p-4 bg-gray-50 rounded-2xl font-bold hover:bg-gray-100 transition-colors"
              >
                <Download className="w-6 h-6 text-green-600" />
                استيراد البيانات (JSON)
              </button>
              <input type="file" id="import-json-settings" accept=".json" className="hidden" onChange={(e) => { handleImportJson(e); setIsSettingsOpen(false); }} />
              <button 
                onClick={() => setPendingAction('exportPdf')}
                className="w-full flex items-center gap-4 p-4 bg-gray-50 rounded-2xl font-bold hover:bg-gray-100 transition-colors"
              >
                <FileText className="w-6 h-6 text-red-600" />
                تصدير تقرير (PDF)
              </button>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="w-full py-4 mt-4 bg-gray-100 text-gray-600 rounded-2xl font-black"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {pendingAction && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[110] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-[3rem] p-8 animate-in zoom-in-95 duration-200 text-center">
            <h2 className="text-2xl font-black mb-4">تأكيد العملية</h2>
            <p className="text-gray-500 font-bold mb-8">هل أنت متأكد من رغبتك في تنفيذ هذه العملية؟</p>
            <div className="flex gap-3">
              <button 
                onClick={() => setPendingAction(null)}
                className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl font-black"
              >
                إلغاء
              </button>
              <button 
                onClick={() => {
                  if (pendingAction === 'exportJson') exportToJson();
                  if (pendingAction === 'exportPdf') exportToPdf();
                  if (pendingAction === 'settings') setIsSettingsOpen(true);
                  setPendingAction(null);
                }}
                className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-lg shadow-indigo-100"
              >
                موافق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logout Modal */}
      {isLogoutModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-[3rem] p-8 animate-in zoom-in-95 duration-200 text-center">
            <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <LogOut className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-black mb-2">تسجيل الخروج</h2>
            <p className="text-gray-500 font-bold mb-8">واش متأكد بغيتي تخرج من الحساب ديالك؟</p>
            
            <div className="flex gap-3">
              <button 
                onClick={() => setIsLogoutModalOpen(false)}
                className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl font-black hover:bg-gray-200 transition-colors"
              >
                إلغاء
              </button>
              <button 
                onClick={confirmLogout}
                className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-black shadow-lg shadow-red-100 hover:bg-red-700 transition-colors"
              >
                تأكيد الخروج
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className={cn(
            "bg-white w-full max-w-sm rounded-[3rem] p-8 text-center transition-all duration-300",
            deleteError ? "shake bg-red-50" : ""
          )}>
            <div className="w-20 h-20 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <Trash2 className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-black mb-2">حذف الكليان؟</h2>
            <p className="text-gray-500 font-bold mb-6">هاد العملية مافيهاش رجوع!</p>
            
            <div className="space-y-4">
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input 
                  type="password"
                  placeholder="أدخل القن السري"
                  value={deletePasswordInput}
                  onChange={(e) => setDeletePasswordInput(e.target.value)}
                  className={cn(
                    "w-full pl-12 pr-6 py-4 bg-gray-50 border-2 rounded-2xl text-center font-black text-xl outline-none transition-all",
                    deleteError ? "border-red-500" : "border-gray-100 focus:border-red-500"
                  )}
                />
              </div>
              
              {deleteError && <p className="text-red-600 font-black text-sm animate-bounce">القن السري غلط! ❌</p>}

              <div className="flex gap-3">
                <button 
                  onClick={() => setIsDeleteModalOpen(false)}
                  className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl font-black"
                >
                  إلغاء
                </button>
                <button 
                  onClick={confirmDelete}
                  className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-black shadow-lg shadow-red-100"
                >
                  تأكيد الحذف
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Photo Viewer Modal */}
      {photoToView && (
        <div className="fixed inset-0 bg-black/95 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={() => setPhotoToView(null)}>
          <button 
            className="absolute top-6 right-6 text-white p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors backdrop-blur-sm"
            onClick={() => setPhotoToView(null)}
          >
            <X className="w-8 h-8" />
          </button>
          <img 
            src={photoToView} 
            alt="Enlarged view" 
            className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

