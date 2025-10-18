import { motion } from "framer-motion";

interface ElfieCharacterProps {
  onAnimationComplete?: () => void;
  isClosing?: boolean;
}

export function ElfieCharacter({ onAnimationComplete, isClosing = false }: ElfieCharacterProps) {
  // Animation variants for Elfie's entrance
  const elfieVariants = {
    hidden: {
      scale: 0,
      y: 0,
      x: 0,
      opacity: 0,
    },
    emerge: {
      scale: 1,
      y: -50,
      x: 20,
      opacity: 1,
      transition: {
        duration: 0.3,
        ease: "easeOut",
      },
    },
    pull: {
      y: -30,
      rotate: -15,
      transition: {
        duration: 0.4,
        ease: "easeInOut",
      },
    },
    wave: {
      rotate: 0,
      transition: {
        duration: 0.15,
      },
    },
    retreat: {
      scale: 0,
      y: 0,
      x: 0,
      opacity: 0,
      transition: {
        duration: 0.15,
        ease: "easeIn",
      },
    },
  };

  // Closing animation (just retreat)
  const closingVariants = {
    hidden: {
      scale: 1,
      opacity: 1,
    },
    retreat: {
      scale: 0,
      opacity: 0,
      transition: {
        duration: 0.3,
        ease: "easeIn",
      },
    },
  };

  return (
    <motion.div
      className="fixed left-4 top-16 z-[100] pointer-events-none"
      initial="hidden"
      animate={isClosing ? "retreat" : ["emerge", "pull", "wave", "retreat"]}
      variants={isClosing ? closingVariants : elfieVariants}
      onAnimationComplete={onAnimationComplete}
    >
      {/* Jetsons-style retro robot character */}
      <svg
        width="80"
        height="100"
        viewBox="0 0 80 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="drop-shadow-2xl"
      >
        {/* Robot body glow */}
        <circle cx="40" cy="60" r="35" fill="url(#glow)" opacity="0.5" />
        
        <defs>
          <linearGradient id="glow" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
          <linearGradient id="bodyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#e9d5ff" />
            <stop offset="100%" stopColor="#c084fc" />
          </linearGradient>
          <linearGradient id="metalGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#d1d5db" />
            <stop offset="50%" stopColor="#f9fafb" />
            <stop offset="100%" stopColor="#d1d5db" />
          </linearGradient>
        </defs>

        {/* Antenna */}
        <line x1="40" y1="20" x2="40" y2="8" stroke="#c084fc" strokeWidth="2" />
        <circle cx="40" cy="6" r="4" fill="#a855f7">
          <animate attributeName="opacity" values="1;0.5;1" dur="1s" repeatCount="indefinite" />
        </circle>

        {/* Head - retro rounded rectangle */}
        <rect x="28" y="20" width="24" height="22" rx="6" fill="url(#bodyGradient)" stroke="#7c3aed" strokeWidth="2" />
        
        {/* Chrome trim on head */}
        <rect x="28" y="20" width="24" height="3" rx="2" fill="url(#metalGradient)" opacity="0.8" />
        
        {/* Eyes - classic robot squares */}
        <rect x="32" y="28" width="6" height="6" rx="1" fill="#0ea5e9">
          <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
        </rect>
        <rect x="42" y="28" width="6" height="6" rx="1" fill="#0ea5e9">
          <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
        </rect>

        {/* Mouth - simple line */}
        <line x1="34" y1="37" x2="46" y2="37" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" />

        {/* Neck - chrome connector */}
        <rect x="37" y="42" width="6" height="4" fill="url(#metalGradient)" />

        {/* Body - rounded retro shape */}
        <ellipse cx="40" cy="62" rx="18" ry="16" fill="url(#bodyGradient)" stroke="#7c3aed" strokeWidth="2" />
        
        {/* Chrome accent on body */}
        <ellipse cx="40" cy="57" rx="14" ry="3" fill="url(#metalGradient)" opacity="0.6" />
        
        {/* Control panel - retro circles */}
        <circle cx="35" cy="65" r="2.5" fill="#0ea5e9" opacity="0.7" />
        <circle cx="40" cy="65" r="2.5" fill="#10b981" opacity="0.7" />
        <circle cx="45" cy="65" r="2.5" fill="#f59e0b" opacity="0.7" />

        {/* Left arm */}
        <motion.g
          animate={{
            rotate: [0, -20, 0],
          }}
          transition={{
            duration: 0.5,
            times: [0, 0.5, 1],
            delay: 0.3,
          }}
          style={{ originX: "24px", originY: "55px" }}
        >
          <rect x="20" y="52" width="4" height="14" rx="2" fill="url(#bodyGradient)" stroke="#7c3aed" strokeWidth="1" />
          <circle cx="22" cy="67" r="3" fill="url(#metalGradient)" stroke="#7c3aed" strokeWidth="1" />
        </motion.g>

        {/* Right arm - the pulling arm */}
        <motion.g
          animate={{
            rotate: [0, 25, 0],
          }}
          transition={{
            duration: 0.5,
            times: [0, 0.5, 1],
            delay: 0.3,
          }}
          style={{ originX: "56px", originY: "55px" }}
        >
          <rect x="56" y="52" width="4" height="14" rx="2" fill="url(#bodyGradient)" stroke="#7c3aed" strokeWidth="1" />
          <circle cx="58" cy="67" r="3" fill="url(#metalGradient)" stroke="#7c3aed" strokeWidth="1" />
        </motion.g>

        {/* Legs - retro style */}
        <rect x="32" y="76" width="5" height="12" rx="2" fill="url(#bodyGradient)" stroke="#7c3aed" strokeWidth="1" />
        <rect x="43" y="76" width="5" height="12" rx="2" fill="url(#bodyGradient)" stroke="#7c3aed" strokeWidth="1" />
        
        {/* Feet - rounded */}
        <ellipse cx="34.5" cy="90" rx="4" ry="3" fill="url(#metalGradient)" stroke="#7c3aed" strokeWidth="1" />
        <ellipse cx="45.5" cy="90" rx="4" ry="3" fill="url(#metalGradient)" stroke="#7c3aed" strokeWidth="1" />

        {/* Retro energy lines */}
        <motion.path
          d="M 15 60 Q 10 60 10 55"
          stroke="#a855f7"
          strokeWidth="2"
          fill="none"
          opacity="0.6"
          animate={{
            opacity: [0.6, 0, 0.6],
          }}
          transition={{
            duration: 1,
            repeat: Infinity,
          }}
        />
        <motion.path
          d="M 65 60 Q 70 60 70 55"
          stroke="#a855f7"
          strokeWidth="2"
          fill="none"
          opacity="0.6"
          animate={{
            opacity: [0.6, 0, 0.6],
          }}
          transition={{
            duration: 1,
            repeat: Infinity,
            delay: 0.5,
          }}
        />
      </svg>
    </motion.div>
  );
}
