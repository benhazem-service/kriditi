import React from 'react';
import { cn } from '../lib/utils';

interface NumericKeypadProps {
  value: string;
  onKeyPress: (key: string) => void;
  onBackspace: () => void;
  onClose: () => void;
}

export const NumericKeypad: React.FC<NumericKeypadProps> = ({ value, onKeyPress, onBackspace, onClose }) => {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white p-4 rounded-t-3xl shadow-2xl z-[60] animate-in slide-in-from-bottom duration-300">
      <div className="flex justify-between items-center mb-4 px-2">
        <button type="button" onClick={onClose} className="text-gray-500 font-bold">إغلاق</button>
      </div>
      <div className="mb-6 px-2">
        <div className="w-full py-6 bg-gray-50 rounded-2xl text-5xl font-black text-center text-indigo-600 border-2 border-indigo-100">
          {value || '0'}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {keys.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => key === '⌫' ? onBackspace() : onKeyPress(key)}
            className={cn(
              "p-6 rounded-2xl text-3xl font-black shadow-sm active:bg-indigo-100 transition-colors",
              key === '⌫' ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-900"
            )}
          >
            {key}
          </button>
        ))}
      </div>
      <button 
        type="button"
        onClick={onClose}
        className="w-full mt-4 p-6 rounded-2xl text-2xl font-black bg-green-500 text-white shadow-lg active:bg-green-600 transition-colors"
      >
        تأكيد
      </button>
    </div>
  );
};
