import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { Play, Pause, RotateCcw, Plus, Trash2, Timer, Clock, CheckSquare, Bell, AlertCircle, CheckCircle, XCircle, Calendar } from 'lucide-react';

// --- Global Firebase Configuration and Utility ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'time-blocker-default';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- Timeline Constants ---
const START_HOUR = 8;
const START_MINUTE = 30;
const END_HOUR = 18;
const END_MINUTE = 30;

const START_TIME_MINUTES = START_HOUR * 60 + START_MINUTE; // 510 minutes (8:30 AM)
const END_TIME_MINUTES = END_HOUR * 60 + END_MINUTE;       // 1110 minutes (6:30 PM)
const TOTAL_CORE_MINUTES = END_TIME_MINUTES - START_TIME_MINUTES; // 600 minutes (10 hours)

const PX_PER_MINUTE = 4; 

// Helper: Simple Beep for Alerts using Web Audio API
const playAlert = (type = 'end') => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    const now = ctx.currentTime;

    if (type === 'end') {
        // Success Tone
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now);       
        osc.frequency.setValueAtTime(659.25, now + 0.15); 
        osc.frequency.setValueAtTime(783.99, now + 0.3);  
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.3, now + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
        osc.start(now);
        osc.stop(now + 0.8);
    } else if (type === 'warning') {
        // 5-Minute Warning
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.linearRampToValueAtTime(1200, now + 0.1);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.1);
        osc.frequency.setValueAtTime(880, now + 0.2);
        osc.frequency.linearRampToValueAtTime(1200, now + 0.3);
        gain.gain.setValueAtTime(0.1, now + 0.2);
        gain.gain.linearRampToValueAtTime(0, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.4);
    } else if (type === 'expired') {
        // Forced Expiration Tone (Low descent)
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(300, now);
        osc.frequency.exponentialRampToValueAtTime(100, now + 0.4);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
    }

    setTimeout(() => {
        if (ctx.state !== 'closed') ctx.close();
    }, 1000);
};

// Helper function to convert HH:MM to minutes from midnight
const timeToMinutes = (time) => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
};

const formatTime = (seconds) => {
  const isNegative = seconds < 0;
  const absSeconds = Math.abs(seconds);
  const m = Math.floor(absSeconds / 60);
  const s = Math.floor(absSeconds % 60);
  return `${isNegative ? '-' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

// --- Components ---

const BigActiveTimer = ({ block, remainingSeconds, isRunning, onTogglePlay, onReset, onToggleSubtask, onToggleComplete, statusLabel }) => {
    if (!block) return (
        <div className="bg-gray-100 rounded-2xl p-6 mb-6 text-center shadow-inner border border-gray-200">
            <h2 className="text-gray-500 font-medium">All caught up! No tasks scheduled for now.</h2>
            <p className="text-sm text-gray-400 mt-2">Add a block below to get started.</p>
        </div>
    );

    const subtaskTime = block.subtasks && block.subtasks.length > 0 
        ? Math.floor(block.duration / block.subtasks.length) 
        : 0;

    // Styling changes based on if it's actually running or just "waiting"
    const containerClass = isRunning 
        ? "bg-indigo-900 text-white ring-4 ring-indigo-200 shadow-2xl" 
        : "bg-white text-gray-800 ring-4 ring-gray-100 shadow-xl border border-gray-200";

    const titleClass = isRunning ? "text-white" : "text-gray-900";
    const subLabelClass = isRunning ? "text-indigo-300" : "text-indigo-600";
    const timeClass = isRunning 
        ? (remainingSeconds < 0 ? 'text-red-400' : 'text-white')
        : "text-gray-800";

    return (
        <div className={`${containerClass} rounded-2xl p-6 mb-6 animate-in fade-in slide-in-from-top-4 transition-colors duration-500`}>
            <div className="flex justify-between items-start mb-4">
                <div>
                    <h2 className={`text-sm font-medium uppercase tracking-wider mb-1 ${subLabelClass}`}>
                        {statusLabel || (isRunning ? "Current Task" : "Up Next / Ready")}
                    </h2>
                    <h1 className={`text-3xl font-bold ${titleClass}`}>{block.name}</h1>
                </div>
                <div className="flex items-center space-x-3">
                     <button
                        onClick={() => onToggleComplete(block.id)}
                        className={`flex items-center px-4 py-2 rounded-full font-bold text-sm transition-colors shadow-sm ${
                            block.completed 
                            ? 'bg-green-500 text-white hover:bg-green-600' 
                            : (isRunning ? 'bg-indigo-700 text-indigo-100 hover:bg-indigo-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
                        }`}
                    >
                        {block.completed ? <CheckCircle className="w-5 h-5 mr-2" /> : <CheckCircle className="w-5 h-5 mr-2" />}
                        {block.completed ? 'Completed' : 'Mark Done'}
                    </button>
                    <span className={`px-3 py-1 rounded-full text-sm font-mono ${isRunning ? 'bg-indigo-800 text-indigo-200' : 'bg-gray-100 text-gray-500'}`}>
                        Ends at {(() => {
                            const [h, m] = block.startTime.split(':').map(Number);
                            const endMin = h * 60 + m + block.duration;
                            return `${String(Math.floor(endMin/60)%24).padStart(2,'0')}:${String(endMin%60).padStart(2,'0')}`;
                        })()}
                    </span>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                <div className="text-center sm:text-left">
                    <div className={`font-mono text-7xl font-black tracking-tighter ${timeClass}`}>
                        {formatTime(remainingSeconds)}
                    </div>
                    {remainingSeconds < 0 && (
                        <p className="text-red-400 font-bold text-sm mt-1 flex items-center justify-center sm:justify-start">
                            <AlertCircle className="w-4 h-4 mr-1" /> Overtime
                        </p>
                    )}
                </div>

                <div className="flex gap-4">
                    <button 
                        onClick={() => onTogglePlay(block.id, !isRunning)}
                        className={`w-16 h-16 rounded-full flex items-center justify-center transition-transform hover:scale-105 shadow-lg ${
                            isRunning 
                            ? 'bg-amber-400 hover:bg-amber-500 text-indigo-900' 
                            : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                        }`}
                    >
                        {isRunning ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current ml-1" />}
                    </button>
                    <button 
                        onClick={() => onReset(block.id)}
                        className={`w-16 h-16 rounded-full flex items-center justify-center transition-transform hover:scale-105 shadow-lg ${
                            isRunning 
                            ? 'bg-indigo-700 hover:bg-indigo-600 text-white' 
                            : 'bg-gray-200 hover:bg-gray-300 text-gray-600'
                        }`}
                    >
                        <RotateCcw className="w-8 h-8" />
                    </button>
                </div>
            </div>

            {/* Subtasks in Big Timer */}
            {block.subtasks && block.subtasks.length > 0 && (
                <div className={`mt-6 rounded-xl p-4 backdrop-blur-sm ${isRunning ? 'bg-indigo-800/50' : 'bg-gray-100'}`}>
                    <h3 className={`text-sm font-semibold mb-2 flex items-center ${isRunning ? 'text-indigo-300' : 'text-gray-500'}`}>
                        <CheckSquare className="w-4 h-4 mr-2" /> Subtasks ({subtaskTime} min each)
                    </h3>
                    <div className="space-y-2">
                        {block.subtasks.map((st, idx) => (
                            <div key={idx} className="flex items-center group cursor-pointer" onClick={() => onToggleSubtask(block.id, idx)}>
                                <div className={`w-5 h-5 rounded border mr-3 flex items-center justify-center transition-colors ${st.done ? 'bg-green-500 border-green-500' : (isRunning ? 'border-indigo-400 bg-transparent' : 'border-gray-300 bg-white')}`}>
                                    {st.done && <CheckSquare className="w-3 h-3 text-white" />}
                                </div>
                                <span className={`${st.done ? 'line-through opacity-50' : ''} ${isRunning ? (st.done ? 'text-indigo-400' : 'text-white') : (st.done ? 'text-gray-400' : 'text-gray-800')}`}>
                                    {st.text}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const TimeBlock = ({ block, isPlaying, onTogglePlay, onReset, onDelete, onAddSubtask, onToggleSubtask, onToggleComplete }) => {
  const { id, name, startTime, duration, totalSeconds, position, subtasks = [], completed = false, expired = false } = block;
  const remainingSeconds = totalSeconds;
  const [newSubtask, setNewSubtask] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  // Spread time calculation
  const timePerSubtask = subtasks.length > 0 ? Math.floor(duration / subtasks.length) : 0;

  const handleTogglePlay = (e) => { e.stopPropagation(); onTogglePlay(id, !isPlaying); };
  const handleReset = (e) => { e.stopPropagation(); onReset(id); };
  const handleDelete = (e) => { e.stopPropagation(); onDelete(id); };
  const handleToggleDone = (e) => { e.stopPropagation(); onToggleComplete(id); };

  const handleAddSubtaskSubmit = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (newSubtask.trim()) {
          onAddSubtask(id, newSubtask);
          setNewSubtask('');
          setIsAdding(false);
      }
  };

  const style = position ? {
    top: `${position.top}px`,
    height: `${position.height}px`,
    zIndex: isPlaying ? 40 : 10, 
  } : {};
  
  // Dynamic Styling based on state
  let bgClass = "bg-white";
  let textClass = "text-gray-800";
  let borderClass = "border-gray-200";
  let statusIcon = null;

  if (completed) {
      bgClass = "bg-emerald-50"; // Green shading for manual done
      textClass = "text-emerald-800 line-through opacity-75"; 
      borderClass = "border-emerald-200";
  } else if (expired) {
      bgClass = "bg-amber-50"; // Orange shading for forced complete/expired
      textClass = "text-amber-800 opacity-75"; 
      borderClass = "border-amber-200 border-dashed";
      statusIcon = <AlertCircle className="w-3 h-3 text-amber-500 mr-1" />;
  } else if (isPlaying) {
      bgClass = "bg-indigo-600";
      textClass = "text-white";
      borderClass = "border-indigo-700";
  }

  const baseClasses = position ? 
    `absolute left-1 right-1 rounded-md transition-all duration-200 border overflow-hidden flex flex-col justify-start group hover:z-[60] hover:h-auto hover:min-h-[fit-content] hover:shadow-2xl hover:bg-white hover:text-gray-900` :
    `w-full rounded-xl p-3 mb-3 shadow-md border border-gray-200`;

  const isSmall = duration < 15;

  return (
    <div
      style={style}
      className={`${baseClasses} ${bgClass} ${textClass} ${borderClass} ${isPlaying ? 'shadow-lg ring-2 ring-amber-400' : 'shadow-sm hover:border-indigo-300'}`}
    >
        {/* Header Section */}
        <div className={`flex justify-between items-center px-2 ${isSmall ? 'py-0 h-full' : 'py-1'} w-full`}>
            <div className="flex-1 min-w-0 flex items-center h-full">
                {/* Done Checkbox */}
                <button 
                    onClick={handleToggleDone}
                    className={`mr-2 p-0.5 rounded-full transition-colors ${
                        completed ? 'text-emerald-600 bg-emerald-100' : 
                        expired ? 'text-amber-600 bg-amber-100' :
                        (isPlaying ? 'text-indigo-200 hover:text-white' : 'text-gray-300 hover:text-green-500')
                    }`}
                    title={expired ? "Expired (Click to mark done)" : "Mark as Done"}
                >
                    {expired ? <XCircle className="w-4 h-4"/> : <CheckCircle className="w-4 h-4" />}
                </button>

                <div className="flex items-center w-full overflow-hidden">
                    {statusIcon}
                    <span className={`truncate ${isPlaying ? 'font-bold' : 'font-semibold'} ${isSmall ? 'text-xs' : 'text-sm'}`}>
                        {name}
                    </span>
                    <span className={`text-[10px] ml-2 whitespace-nowrap ${isPlaying ? 'text-indigo-100 group-hover:text-gray-500' : 'text-gray-400'}`}>
                        {startTime}
                    </span>
                </div>
            </div>
            
            {/* Controls */}
            {(!completed && !expired) && (
                <div className={`flex items-center space-x-1 ml-2 ${isSmall ? 'hidden group-hover:flex' : 'flex'} transition-opacity`}>
                    <div className={`font-mono font-bold ${isSmall ? 'text-xs mr-2' : 'text-sm mr-2'} ${isPlaying ? 'text-white group-hover:text-gray-600' : 'text-gray-600'}`}>
                        {formatTime(remainingSeconds)}
                    </div>
                    
                    <button
                        onClick={handleTogglePlay}
                        className={`p-1 rounded shadow-sm hover:scale-110 transition-transform ${isPlaying ? 'bg-amber-400 text-indigo-900' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}
                    >
                        {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                    </button>
                    
                    <div className="hidden group-hover:flex space-x-1">
                        <button onClick={handleReset} className="p-1 rounded shadow-sm bg-gray-100 text-gray-600 hover:bg-gray-200">
                            <RotateCcw className="w-3 h-3" />
                        </button>
                        <button onClick={handleDelete} className="p-1 rounded shadow-sm bg-red-50 text-red-500 hover:bg-red-100">
                            <Trash2 className="w-3 h-3" />
                        </button>
                    </div>
                </div>
            )}
             {(completed || expired) && (
                 <div className="hidden group-hover:flex ml-2">
                     <button onClick={handleDelete} className="p-1 rounded shadow-sm bg-red-50 text-red-500 hover:bg-red-100">
                         <Trash2 className="w-3 h-3" />
                     </button>
                 </div>
             )}
        </div>

        {/* Subtasks Section */}
        <div className={`px-2 pb-2 w-full ${isSmall ? 'hidden group-hover:block bg-white z-50 rounded-b-md shadow-xl border-x border-b border-gray-200 -mx-px' : 'block'}`}>
            
            {subtasks.length > 0 && (
                <div className="mt-1 space-y-1">
                    {subtasks.map((st, idx) => (
                        <div 
                            key={idx} 
                            onClick={(e) => { e.stopPropagation(); onToggleSubtask(id, idx); }}
                            className={`flex items-center text-xs cursor-pointer p-1 rounded ${isPlaying ? 'text-indigo-100 group-hover:text-gray-700 hover:bg-white/10 group-hover:hover:bg-gray-100' : 'text-gray-600 hover:bg-black/5'}`}
                        >
                            <div className={`w-3 h-3 border rounded mr-2 flex items-center justify-center ${st.done ? 'bg-green-400 border-green-400' : 'border-gray-400'}`}>
                                {st.done && <CheckSquare className="w-2 h-2 text-white" />}
                            </div>
                            <span className={`flex-1 truncate ${st.done ? 'line-through opacity-60' : ''}`}>{st.text}</span>
                            <span className="text-[9px] opacity-60 ml-2">{timePerSubtask}m</span>
                        </div>
                    ))}
                </div>
            )}

            {(!completed && !expired) && (
                <div className="mt-2 hidden group-hover:block">
                    {!isAdding ? (
                        <button 
                            onClick={(e) => { e.stopPropagation(); setIsAdding(true); }}
                            className={`text-[10px] flex items-center ${isPlaying && !isSmall ? 'text-indigo-200 group-hover:text-indigo-500 hover:text-white group-hover:hover:text-indigo-700' : 'text-indigo-500 hover:text-indigo-700'}`}
                        >
                            <Plus className="w-3 h-3 mr-1" /> Add Checklist
                        </button>
                    ) : (
                        <form onSubmit={handleAddSubtaskSubmit} className="flex items-center mt-1">
                            <input
                                type="text"
                                value={newSubtask}
                                onChange={(e) => setNewSubtask(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                placeholder="Subtask..."
                                className="w-full text-xs p-1 border rounded mr-1 text-gray-800"
                                autoFocus
                            />
                            <button type="submit" className="p-1 bg-green-500 text-white rounded text-xs">Add</button>
                        </form>
                    )}
                </div>
            )}
        </div>
    </div>
  );
};

// --- Add Scheduler Component ---
const Scheduler = ({ onAddBlock, schedule }) => {
  const calculateNextStartTime = (currentSchedule) => {
    if (currentSchedule.length === 0) return '08:30';
    const lastBlock = currentSchedule[currentSchedule.length - 1];
    const { startTime: lastStartTime, duration: lastDuration } = lastBlock;
    const [h, m] = lastStartTime.split(':').map(Number);
    const endMin = h * 60 + m + lastDuration;
    return `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
  };

  const initialStartTime = calculateNextStartTime(schedule);
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState(initialStartTime);
  const [duration, setDuration] = useState(45);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => { setStartTime(initialStartTime); }, [initialStartTime]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name && startTime && duration > 0) {
      onAddBlock({ name, startTime, duration: parseInt(duration), subtasks: [], completed: false, expired: false });
      setName('');
      setDuration(45);
      setStartTime(calculateNextStartTime([...schedule, { startTime, duration }]));
      setShowForm(false);
    }
  };

  if (!showForm) {
    return (
      <div className="text-center p-4">
        <button onClick={() => setShowForm(true)} className="w-full max-w-sm mx-auto p-4 bg-indigo-500 text-white font-bold rounded-2xl hover:bg-indigo-600 transition duration-300 flex items-center justify-center shadow-lg transform hover:scale-[1.01]">
          <Plus className="w-5 h-5 mr-2" /> Add New Time Block
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 bg-white rounded-2xl shadow-inner mb-6 max-w-xl mx-auto border border-indigo-100">
      <h2 className="text-xl font-bold mb-4 text-indigo-800">Add New Block</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input type="text" placeholder="Block Name" value={name} onChange={(e) => setName(e.target.value)} className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500" required />
        <div className="flex space-x-3">
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="flex-1 p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500" required />
          <input type="number" placeholder="Duration (min)" min="5" max="180" value={duration} onChange={(e) => setDuration(e.target.value)} className="flex-1 p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500" required />
        </div>
        <div className="flex space-x-2 pt-2">
          <button type="submit" className="flex-1 p-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 shadow-md">Create Block</button>
          <button type="button" onClick={() => setShowForm(false)} className="p-3 bg-gray-300 text-gray-800 font-bold rounded-xl hover:bg-gray-400 shadow-md">Cancel</button>
        </div>
      </form>
    </div>
  );
};

// --- Main App Component ---

const App = () => {
  const [db, setDb] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [activeTimerId, setActiveTimerId] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState({});
  const timerRef = useRef(null);
  
  // Real-time Clock State (Updated every second)
  const [now, setNow] = useState(new Date());

  // --- Firebase Init ---
  useEffect(() => {
    if (!firebaseConfig) { setError("Firebase config missing."); setLoading(false); return; }
    const app = initializeApp(firebaseConfig);
    const firestore = getFirestore(app);
    const authInstance = getAuth(app);
    setDb(firestore);

    const authenticate = async () => {
      let user = null;
      try {
        user = initialAuthToken 
            ? (await signInWithCustomToken(authInstance, initialAuthToken)).user 
            : (await signInAnonymously(authInstance)).user;
      } catch (e) { setError("Auth failed."); }
      if (user && user.uid) { setUserId(user.uid); setIsAuthReady(true); } else { setIsAuthReady(false); if (!error) setError("Auth failed."); }
      setLoading(false);
    };
    authenticate();
    return onAuthStateChanged(authInstance, (user) => { if (!user) { setUserId(null); setIsAuthReady(false); } });
  }, []);

  // --- Clock Sync (1 second interval) ---
  useEffect(() => {
    const clockInterval = setInterval(() => {
        setNow(new Date());
    }, 1000); 
    return () => clearInterval(clockInterval);
  }, []);
  
  // Derived minutes for logic comparison
  const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

  // --- Firestore Sync ---
  useEffect(() => {
    if (!db || !isAuthReady || !userId) return;
    const scheduleDocRef = doc(db, `/artifacts/${appId}/users/${userId}/schedules`, 'dailySchedule');
    const unsubscribe = onSnapshot(scheduleDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const blocks = docSnap.data().blocks || [];
        setSchedule(blocks);
        setTimeRemaining(prev => {
          const newRem = {};
          blocks.forEach(b => {
             newRem[b.id] = (b.id in prev) ? prev[b.id] : b.duration * 60;
          });
          return newRem;
        });
      } else { setSchedule([]); setTimeRemaining({}); }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [db, isAuthReady, userId]);

  const saveSchedule = useCallback(async (newSchedule) => {
    if (!db || !userId) return;
    try { await setDoc(doc(db, `/artifacts/${appId}/users/${userId}/schedules`, 'dailySchedule'), { blocks: newSchedule }, { merge: false }); } catch (e) { console.error(e); }
  }, [db, userId]);

  // --- Auto-Expiration Logic ---
  useEffect(() => {
      if (schedule.length === 0) return;

      let hasChanges = false;
      const newSchedule = schedule.map(block => {
          if (block.completed || block.expired) return block;

          const startMin = timeToMinutes(block.startTime);
          const endMin = startMin + block.duration;

          // If current time > end time, mark as expired
          if (currentTimeMinutes > endMin) {
              hasChanges = true;
              // Stop timer if this one was running
              if (activeTimerId === block.id) {
                  clearInterval(timerRef.current);
                  setActiveTimerId(null);
                  playAlert('expired'); // Sad tone
              }
              return { ...block, expired: true };
          }
          return block;
      });

      if (hasChanges) {
          saveSchedule(newSchedule);
      }
  }, [currentTimeMinutes, schedule, activeTimerId, saveSchedule]);

  // --- Handlers ---
  const handleAddBlock = (newBlock) => {
    const blockWithId = { ...newBlock, id: crypto.randomUUID(), totalSeconds: newBlock.duration * 60 };
    const newSchedule = [...schedule, blockWithId].sort((a, b) => a.startTime.localeCompare(b.startTime));
    saveSchedule(newSchedule);
    setTimeRemaining(prev => ({ ...prev, [blockWithId.id]: blockWithId.totalSeconds }));
  };

  const handleDeleteBlock = (id) => {
    if (activeTimerId === id) setActiveTimerId(null);
    const newSchedule = schedule.filter(b => b.id !== id);
    saveSchedule(newSchedule);
  };

  const handleTogglePlay = (id, play) => {
    if (play) {
      if (activeTimerId !== id) {
        if (activeTimerId) clearInterval(timerRef.current);
        setActiveTimerId(id);
      }
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) new AudioContext().resume();
    } else {
      clearInterval(timerRef.current);
      setActiveTimerId(null);
    }
  };

  const handleReset = (id) => {
    const block = schedule.find(b => b.id === id);
    if (!block) return;
    if (activeTimerId === id) { clearInterval(timerRef.current); setActiveTimerId(null); }
    setTimeRemaining(prev => ({ ...prev, [id]: block.duration * 60 }));
  };

  const handleAddSubtask = (blockId, text) => {
      const newSchedule = schedule.map(b => {
          if (b.id === blockId) {
              const subtasks = b.subtasks ? [...b.subtasks, { text, done: false }] : [{ text, done: false }];
              return { ...b, subtasks };
          }
          return b;
      });
      saveSchedule(newSchedule);
  };

  const handleToggleSubtask = (blockId, index) => {
      const newSchedule = schedule.map(b => {
          if (b.id === blockId && b.subtasks) {
              const subtasks = [...b.subtasks];
              subtasks[index] = { ...subtasks[index], done: !subtasks[index].done };
              return { ...b, subtasks };
          }
          return b;
      });
      saveSchedule(newSchedule);
  };

  const handleToggleComplete = (blockId) => {
      const newSchedule = schedule.map(b => {
          if (b.id === blockId) {
              const isNowCompleted = !b.completed;
              if (isNowCompleted && activeTimerId === blockId) {
                  clearInterval(timerRef.current);
                  setActiveTimerId(null);
              }
              // Un-expire if manually marking as done/undone
              return { ...b, completed: isNowCompleted, expired: false };
          }
          return b;
      });
      saveSchedule(newSchedule);
  };

  // --- Timer Loop with Alerts ---
  useEffect(() => {
    if (activeTimerId) {
      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setTimeRemaining(prev => {
          const current = prev[activeTimerId];
          if (current === undefined) return prev;

          const nextTime = current - 1;

          if (nextTime === 0) playAlert('end'); 
          if (nextTime === 300) playAlert('warning'); 

          return { ...prev, [activeTimerId]: nextTime };
        });
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [activeTimerId]);

  // --- UI Layout ---
  const { coreSchedule, overtimeSchedule } = schedule.reduce((acc, block) => {
      const startMin = timeToMinutes(block.startTime);
      const endMin = startMin + block.duration;
      const isCore = startMin >= START_TIME_MINUTES && endMin <= END_TIME_MINUTES;
      const top = (startMin - START_TIME_MINUTES) * PX_PER_MINUTE;
      const height = block.duration * PX_PER_MINUTE;
      
      const enrichedBlock = { ...block, position: isCore ? { top, height } : null };
      isCore ? acc.coreSchedule.push(enrichedBlock) : acc.overtimeSchedule.push(enrichedBlock);
      return acc;
  }, { coreSchedule: [], overtimeSchedule: [] });

  // Determine Focus Task:
  // 1. If timer is running, that's the focus.
  // 2. If not, find the first upcoming task that isn't done/expired.
  const activeBlock = schedule.find(b => b.id === activeTimerId);
  const nextUpBlock = !activeBlock 
    ? schedule.find(b => !b.completed && !b.expired && (timeToMinutes(b.startTime) + b.duration >= currentTimeMinutes)) 
    : null;

  const bigTimerBlock = activeBlock || nextUpBlock;

  // Format Clock Time
  const formattedTime = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const formattedDate = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-gray-50">Loading...</div>;
  if (error) return <div className="min-h-screen flex items-center justify-center bg-red-100">{error}</div>;

  const hourlyLabels = [];
  for (let m = START_TIME_MINUTES; m <= END_TIME_MINUTES; m += 60) {
      const h = Math.floor(m / 60) % 24;
      const min = m % 60;
      const ampm = h < 12 || h === 24 ? 'AM' : 'PM';
      hourlyLabels.push({ time: `${String(h%12||12).padStart(2,'0')}:${String(min).padStart(2,'0')} ${ampm}`, offset: (m - START_TIME_MINUTES) * PX_PER_MINUTE });
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900 pb-20">
      <header className="bg-indigo-700 text-white p-6 shadow-xl sticky top-0 z-30 rounded-b-3xl flex justify-between items-center">
        <div>
            <h1 className="text-3xl font-extrabold mb-1">Focus Assistant</h1>
            <p className="text-indigo-200 text-sm">Visual schedule management.</p>
        </div>
        <div className="text-right">
            <div className="text-2xl font-mono font-bold tracking-tight">
                {formattedTime}
            </div>
            <div className="text-indigo-200 text-xs uppercase font-semibold tracking-wider flex items-center justify-end">
                <Calendar className="w-3 h-3 mr-1" />
                {formattedDate}
            </div>
        </div>
      </header>

      <main className="p-4 max-w-xl mx-auto">
        
        {/* BIG TIMER DISPLAY (Shows Active OR Next Up) */}
        {bigTimerBlock && (
            <BigActiveTimer 
                block={bigTimerBlock}
                remainingSeconds={timeRemaining[bigTimerBlock.id] !== undefined ? timeRemaining[bigTimerBlock.id] : bigTimerBlock.duration * 60}
                isRunning={!!activeBlock} // Only true if actually running
                onTogglePlay={handleTogglePlay}
                onReset={handleReset}
                onToggleSubtask={handleToggleSubtask}
                onToggleComplete={handleToggleComplete}
            />
        )}

        <Scheduler onAddBlock={handleAddBlock} schedule={schedule} /> 
        
        <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center">
            <Clock className="w-6 h-6 mr-2 text-indigo-600" /> Core Work Day
        </h2>
        
        <div className="relative bg-white rounded-xl shadow-xl border border-gray-200 h-[600px] overflow-y-auto overflow-x-hidden">
            <div style={{ height: `${(TOTAL_CORE_MINUTES * PX_PER_MINUTE) + 40}px` }} className="relative w-full">
                <div className="absolute left-0 top-0 bottom-0 w-16 border-r border-gray-300 bg-gray-50 z-0">
                    {hourlyLabels.map((l, i) => (
                        <div key={i} style={{ top: `${l.offset}px` }} className="absolute right-0 w-full text-right pr-2 text-xs font-medium text-gray-500">
                            {l.time}
                            <div className="absolute right-0 h-px w-2 bg-gray-300 transform translate-x-1.5 translate-y-2"></div>
                        </div>
                    ))}
                </div>
                <div className="absolute left-16 right-0 top-0 bottom-0">
                    {coreSchedule.map(block => (
                        <TimeBlock
                            key={block.id}
                            block={{ ...block, totalSeconds: timeRemaining[block.id] !== undefined ? timeRemaining[block.id] : block.duration * 60 }}
                            isPlaying={activeTimerId === block.id}
                            onTogglePlay={handleTogglePlay}
                            onReset={handleReset}
                            onDelete={handleDeleteBlock}
                            onAddSubtask={handleAddSubtask}
                            onToggleSubtask={handleToggleSubtask}
                            onToggleComplete={handleToggleComplete}
                        />
                    ))}
                </div>
            </div>
        </div>
        
        <h2 className="text-xl font-bold text-gray-800 mt-8 mb-4">Overtime / Extended Hours</h2>
        <div className="p-4 bg-white rounded-xl shadow-lg border border-gray-200">
            {overtimeSchedule.length > 0 ? (
                <div className="space-y-3">
                    {overtimeSchedule.map(block => (
                        <TimeBlock
                            key={block.id}
                            block={{ ...block, totalSeconds: timeRemaining[block.id] !== undefined ? timeRemaining[block.id] : block.duration * 60 }}
                            isPlaying={activeTimerId === block.id}
                            onTogglePlay={handleTogglePlay}
                            onReset={handleReset}
                            onDelete={handleDeleteBlock}
                            onAddSubtask={handleAddSubtask}
                            onToggleSubtask={handleToggleSubtask}
                            onToggleComplete={handleToggleComplete}
                        />
                    ))}
                </div>
            ) : <p className="text-gray-500 italic">No extended blocks.</p>}
        </div>
      </main>
    </div>
  );
};

export default App;