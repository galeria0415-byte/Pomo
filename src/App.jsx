import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';
import { Play, Pause, RotateCcw, Plus, Trash2, Timer, Clock, CheckSquare, AlertCircle, CheckCircle, XCircle, Calendar, LogOut, Edit } from 'lucide-react';

// --- Global Firebase Configuration and Utility ---
// --- USER PROVIDED FIREBASE CONFIGURATION (FOR LOCAL DEPLOYMENT) ---
const appId = "pomodoro-ff0ed"; // Using projectId as a consistent identifier
const firebaseConfig = {
    // API KEY INSERTED HERE
    apiKey: "AIzaSyC7wZ3XYoyi06W6E0UbwQD6de1v76nBXn8", 
    authDomain: "pomodoro-ff0ed.firebaseapp.com",
    projectId: "pomodoro-ff0ed",
    storageBucket: "pomodoro-ff0ed.firebasestorage.app",
    messagingSenderId: "446478415052",
    appId: "1:446478415052:web:626b873227469897b33e69"
};
const initialAuthToken = null; 

// --- Timeline Constants ---
const START_HOUR = 8;
const START_MINUTE = 30;
const END_HOUR = 18;
const END_MINUTE = 30;

const START_TIME_MINUTES = START_HOUR * 60 + START_MINUTE; // 510 minutes (8:30 AM)
const END_TIME_MINUTES = END_HOUR * 60 + END_MINUTE;       // 1110 minutes (6:30 PM)
const TOTAL_CORE_MINUTES = END_TIME_MINUTES - START_TIME_MINUTES; // 600 minutes (10 hours)

// FIX 1: Increased scale to 5px per minute for better separation.
const PX_PER_MINUTE = 5; 

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

// --- Authentication Component (Top-level) ---
const AuthComponent = ({ auth }) => {
    const [authError, setAuthError] = useState('');

    const handleGoogleSignIn = async () => {
        setAuthError('');
        try {
            const provider = new GoogleAuthProvider();
            await signInWithPopup(auth, provider);
        } catch (error) {
            if (error.code !== 'auth/popup-closed-by-user') {
                setAuthError("Sign-in failed. Check your Firebase console and network connection.");
                console.error(error);
            }
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
            <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-2xl border border-indigo-100">
                <h2 className="text-3xl font-bold mb-6 text-center text-indigo-800">
                    Sign In to Focus Assistant
                </h2>
                
                {authError && 
                    <div className="p-3 mb-4 bg-red-100 text-red-700 rounded-xl text-sm border border-red-200">
                        Authentication Error: {authError}
                    </div>
                }

                <button
                    onClick={handleGoogleSignIn}
                    className="w-full p-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 shadow-md transition flex items-center justify-center space-x-2"
                >
                    {/* Inline Google SVG Logo */}
                    <svg className="w-5 h-5" viewBox="0 0 48 48">
                        <path fill="#FFC107" d="M43.61,20.083H42V20H24v8h11.343c-0.909,3.95-3.693,6.586-8.89,6.586c-6.845,0-12.456-5.834-12.456-13.069 C14,14.249,19.61,8.415,26.455,8.415c3.393,0,6.012,1.385,7.95,3.228l5.228-4.998C36.877,3.606,32.26,1.415,26.455,1.415 C14.9,1.415,5.289,11.428,5.289,23.491s9.611,22.076,21.166,22.076c11.026,0,20.485-7.905,20.485-21.84 C46.939,22.753,46.2,21.328,43.61,20.083z"/>
                        <path fill="#FF3D00" d="M5.289,23.491c0-1.859,0.312-3.654,0.892-5.328L1.936,14.39C1.353,16.038,1,17.765,1,19.623s0.353,3.585,0.936,5.233L6.181,28.819C5.601,27.144,5.289,25.35,5.289,23.491z"/>
                        <path fill="#4CAF50" d="M26.455,45.567c-6.736,0-12.383-2.923-16.143-6.527l5.378-4.161c3.084,3.176,7.575,5.19,10.765,5.19 c4.113,0,6.966-1.921,8.423-3.328c1.458-1.408,1.96-3.218,1.96-4.85v-7.054H24v-8h11.343c0.41,1.834,0.73,3.882,0.73,6.234 C36.073,40.162,31.323,45.567,26.455,45.567z"/>
                        <path fill="#1976D2" d="M43.61,20.083c0.407,1.139,0.706,2.29,0.939,3.472c0.046,0.222,0.09,0.444,0.13,0.666 C44.83,27.794,42.755,36.56,36.073,40.162l-5.378-4.161c4.957-3.921,7.202-9.757,6.845-14.718h-11.343v-8h18.25 C47.16,16.892,45.474,18.91,43.61,20.083z"/>
                    </svg>
                    <span>Sign In with Google</span>
                </button>
            </div>
        </div>
    );
};


// --- Modal Component (Top-level) ---
const EditTaskModal = ({ block, onSave, onCancel }) => {
    const [name, setName] = useState(block.name);
    const [startTime, setStartTime] = useState(block.startTime);
    const [duration, setDuration] = useState(block.duration);

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(block.id, {
            name,
            startTime,
            duration: parseInt(duration),
        });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6">
                <h3 className="text-xl font-bold mb-4 text-indigo-800">Edit Task</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <input
                        type="text"
                        placeholder="Task Name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
                        required
                    />
                    <div className="flex space-x-3">
                        <input
                            type="time"
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                            className="flex-1 p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
                            required
                        />
                        <input
                            type="number"
                            placeholder="Duration (min)"
                            min="5"
                            max="180"
                            value={duration}
                            onChange={(e) => setDuration(e.target.value)}
                            className="flex-1 p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-indigo-500"
                            required
                        />
                    </div>
                    <div className="flex justify-end space-x-2 pt-2">
                        <button type="button" onClick={onCancel} className="p-3 bg-gray-300 text-gray-800 font-bold rounded-xl hover:bg-gray-400">
                            Cancel
                        </button>
                        <button type="submit" className="p-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700">
                            Save Changes
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- Big Active Timer Component (Top-level) ---
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


// --- Time Block Component (Top-level) ---
const TimeBlock = ({ block, isPlaying, onTogglePlay, onReset, onDelete, onAddSubtask, onToggleSubtask, onToggleComplete, onEditBlock }) => {
  const { id, name, startTime, duration, totalSeconds, position, subtasks = [], completed = false, expired = false } = block;
  const remainingSeconds = totalSeconds;
  const [newSubtask, setNewSubtask] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  
  // FIX 3: Removed drag state and refs
  const blockRef = useRef(null); // Keep ref for future enhancements if needed
  
  // Spread time calculation
  const timePerSubtask = subtasks.length > 0 ? Math.floor(duration / subtasks.length) : 0;

  // FIX 2: All handlers explicitly call e.stopPropagation()
  const handleTogglePlay = (e) => { e.stopPropagation(); onTogglePlay(id, !isPlaying); };
  const handleReset = (e) => { e.stopPropagation(); onReset(id); };
  const handleDelete = (e) => { e.stopPropagation(); onDelete(id); };
  const handleToggleDone = (e) => { e.stopPropagation(); onToggleComplete(id); };
  const handleEdit = (e) => { e.stopPropagation(); setIsEditing(true); };

  const handleAddSubtaskSubmit = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (newSubtask.trim()) {
          onAddSubtask(id, newSubtask);
          setNewSubtask('');
          setIsAdding(false);
      }
  };
  
  const handleSaveEdit = (blockId, updatedFields) => {
      onEditBlock(blockId, updatedFields);
      setIsEditing(false);
  };


  const style = position ? {
    top: `${position.top}px`, 
    height: `${position.height}px`,
    // Z-index management kept simple
    zIndex: isPlaying ? 40 : 10, 
    cursor: 'default', // No dragging allowed
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

  // Adjusted base classes to rely on hover and static Z-index
  const baseClasses = position ? 
    `absolute left-1 right-1 rounded-md transition-all duration-200 border overflow-hidden flex flex-col justify-start group hover:z-[60] hover:h-auto hover:min-h-[fit-content] hover:shadow-2xl hover:bg-white hover:text-gray-900` :
    `w-full rounded-xl p-3 mb-3 shadow-md border border-gray-200 group`;

  const isSmall = duration < 15;

  return (
    <>
    {isEditing && <EditTaskModal block={block} onSave={handleSaveEdit} onCancel={() => setIsEditing(false)} />}
    
    <div
      ref={blockRef}
      style={style}
      className={`${baseClasses} ${bgClass} ${textClass} ${borderClass} ${isPlaying ? 'shadow-lg ring-2 ring-amber-400' : 'shadow-sm hover:border-indigo-300'}`}
      // Removed onMouseDown and onTouchStart handlers
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
                        <button onClick={handleEdit} className="p-1 rounded shadow-sm bg-gray-100 text-gray-600 hover:bg-gray-200" title="Edit Task">
                            <Edit className="w-3 h-3" />
                        </button>
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
    </>
  );
};

// --- Add Scheduler Component (Top-level) ---
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

// --- Main App Component (Top-level) ---
const App = () => {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null); 
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
    if (!firebaseConfig || !firebaseConfig.apiKey) { 
        setError("Firebase configuration is missing or invalid. Please check your apiKey."); 
        setLoading(false); 
        return; 
    }
    
    const app = initializeApp(firebaseConfig);
    const firestore = getFirestore(app);
    const authInstance = getAuth(app);
    setDb(firestore);
    setAuth(authInstance); 

    const unsubscribe = onAuthStateChanged(authInstance, (user) => {
        if (user) {
            setUserId(user.uid);
            setIsAuthReady(true);
        } else {
            setUserId(null);
            setIsAuthReady(true);
        }
        setLoading(false);
    });
    
    return () => unsubscribe();
  }, []);

  const handleSignOut = async () => {
      if (auth) {
          try {
              await signOut(auth);
          } catch (e) {
              console.error("Sign out failed:", e);
          }
      }
  };

  // --- Clock Sync (1 second interval) ---
  useEffect(() => {
    const clockInterval = setInterval(() => {
        setNow(new Date());
    }, 1000); 
    return () => clearInterval(clockInterval);
  }, []);
  
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

          if (currentTimeMinutes > endMin) {
              hasChanges = true;
              if (activeTimerId === block.id) {
                  clearInterval(timerRef.current);
                  setActiveTimerId(null);
                  playAlert('expired'); 
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
  const updateScheduleAndSave = useCallback((newSchedule) => {
      // Re-sort schedule after change, just in case time changes were made
      const sortedSchedule = newSchedule.sort((a, b) => a.startTime.localeCompare(b.startTime));
      saveSchedule(sortedSchedule);
  }, [saveSchedule]);


  const handleAddBlock = (newBlock) => {
    const blockWithId = { ...newBlock, id: crypto.randomUUID(), totalSeconds: newBlock.duration * 60 };
    updateScheduleAndSave([...schedule, blockWithId]);
    setTimeRemaining(prev => ({ ...prev, [blockWithId.id]: blockWithId.totalSeconds }));
  };

  const handleDeleteBlock = (id) => {
    if (activeTimerId === id) setActiveTimerId(null);
    const newSchedule = schedule.filter(b => b.id !== id);
    updateScheduleAndSave(newSchedule);
  };
  
  const handleEditBlock = (id, updatedFields) => {
      const newSchedule = schedule.map(b => {
          if (b.id === id) {
              // Ensure we update totalSeconds if duration changed
              const newDuration = updatedFields.duration || b.duration;
              return { 
                  ...b, 
                  ...updatedFields, 
                  duration: newDuration,
                  totalSeconds: newDuration * 60 
              };
          }
          return b;
      });
      // Reset timer countdown on edit
      setTimeRemaining(prev => ({ ...prev, [id]: updatedFields.duration * 60 }));
      updateScheduleAndSave(newSchedule);
  };

  const handleReorderBlock = (id, newStartTime) => {
      const newSchedule = schedule.map(b => {
          if (b.id === id) {
              return { ...b, startTime: newStartTime };
          }
          return b;
      });
      // Sorting is crucial here to keep the scheduler queue correct
      updateScheduleAndSave(newSchedule);
  };

  // --- Template Save/Load Functions ---
  const [templateSaved, setTemplateSaved] = useState(false);

  const saveAsTemplate = () => {
    if (schedule.length === 0) {
      alert('No tasks to save! Add some tasks first.');
      return;
    }
    
    const template = schedule.map(block => ({
      name: block.name,
      startTime: block.startTime,
      duration: block.duration,
      subtasks: block.subtasks || []
    }));
    
    localStorage.setItem('pomodoroTemplate', JSON.stringify(template));
    setTemplateSaved(true);
    setTimeout(() => setTemplateSaved(false), 2000);
  };

  const loadFromTemplate = () => {
    const savedTemplate = localStorage.getItem('pomodoroTemplate');
    
    if (!savedTemplate) {
      alert('No saved template found! Save a template first.');
      return;
    }
    
    const confirmLoad = window.confirm('This will replace all current tasks with the template. Continue?');
    if (!confirmLoad) return;
    
    const template = JSON.parse(savedTemplate);
    const newBlocks = template.map(task => ({
      id: crypto.randomUUID(),
      name: task.name,
      startTime: task.startTime,
      duration: task.duration,
      subtasks: task.subtasks || [],
      completed: false,
      totalSeconds: task.duration * 60
    }));
    
    // Save to Firebase
    updateScheduleAndSave(newBlocks);
    
    // Initialize time remaining for each block
    const newTimeRemaining = {};
    newBlocks.forEach(block => {
      newTimeRemaining[block.id] = block.totalSeconds;
    });
    setTimeRemaining(newTimeRemaining);
    
    // Reset active timer
    setActiveTimerId(null);
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

  // --- AUTH CHECK: If Auth is ready but no userId is present, show the sign-in form. ---
  if (isAuthReady && !userId) {
      return <AuthComponent auth={auth} />;
  }
  
  if (!isAuthReady) {
      return <div className="min-h-screen flex items-center justify-center bg-gray-50">Authenticating...</div>;
  }
  // --- END AUTH CHECK ---

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
        <div className="text-right flex items-center space-x-4">
            <div>
                <div className="text-2xl font-mono font-bold tracking-tight">
                    {formattedTime}
                </div>
                <div className="text-indigo-200 text-xs uppercase font-semibold tracking-wider flex items-center justify-end">
                    <Calendar className="w-3 h-3 mr-1" />
                    {formattedDate}
                </div>
            </div>
            <button 
                onClick={handleSignOut}
                className="p-2 bg-indigo-600 hover:bg-indigo-800 rounded-full transition duration-150 shadow-md"
                title="Sign Out"
            >
                <LogOut className="w-5 h-5" />
            </button>
        </div>
      </header>

      <main className="p-4 max-w-xl mx-auto">
        
        {/* BIG TIMER DISPLAY (Shows Active OR Next Up) */}
        {bigTimerBlock && (
            <BigActiveTimer 
                block={bigTimerBlock}
                remainingSeconds={timeRemaining[bigTimerBlock.id] !== undefined ? timeRemaining[bigTimerBlock.id] : bigTimerBlock.duration * 60}
                isRunning={!!activeBlock} 
                onTogglePlay={handleTogglePlay}
                onReset={handleReset}
                onToggleSubtask={handleToggleSubtask}
                onToggleComplete={handleToggleComplete}
            />
        )}

        <Scheduler onAddBlock={handleAddBlock} schedule={schedule} /> 
        
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center">
              <Clock className="w-6 h-6 mr-2 text-indigo-600" /> Core Work Day
          </h2>
          <div className="flex gap-2">
            <button
              onClick={loadFromTemplate}
              className="bg-green-600 text-white p-2 rounded-lg hover:bg-green-700 transition shadow-md"
              title="Load saved template"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </button>
            <button
              onClick={saveAsTemplate}
              className={`${templateSaved ? 'bg-green-600' : 'bg-purple-600'} text-white p-2 rounded-lg ${templateSaved ? 'hover:bg-green-700' : 'hover:bg-purple-700'} transition shadow-md`}
              title={templateSaved ? 'Template saved!' : 'Save current tasks as template'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {templateSaved ? (
                  <polyline points="20 6 9 17 4 12"></polyline>
                ) : (
                  <>
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                    <polyline points="7 3 7 8 15 8"></polyline>
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>
        
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
                            // Removed onReorderBlock prop
                            onEditBlock={handleEditBlock}
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
                            // Removed onReorderBlock prop
                            onEditBlock={handleEditBlock}
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