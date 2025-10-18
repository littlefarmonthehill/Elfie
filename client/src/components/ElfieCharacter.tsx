import { motion } from "framer-motion";

interface ElfieCharacterProps {
  onAnimationComplete?: () => void;
  isClosing?: boolean;
}

export function ElfieCharacter({ onAnimationComplete, isClosing = false, isResting = false }: ElfieCharacterProps & { isResting?: boolean }) {
  // Animation variants for Elfie's entrance - flies DOWN in zigzag pattern
  const elfieVariants = {
    hidden: {
      scale: 0,
      x: 0,
      y: 0,
      opacity: 0,
    },
    emerge: {
      scale: 1.2,
      x: 0,
      y: 0,
      opacity: 1,
      transition: {
        duration: 0.4,
        ease: "easeOut",
      },
    },
    flyDown: {
      scale: 1.4,
      x: 0,
      y: "calc(100vh - 80px)",
      rotate: 0,
      opacity: 1,
      transition: {
        duration: 0.8,
        ease: "easeInOut",
      },
    },
    pull: {
      scale: 1.4,
      x: 0,
      y: "calc(100vh - 100px)",
      rotate: 10,
      opacity: 1,
      transition: {
        duration: 0.4,
        ease: "easeInOut",
      },
    },
    zigzag1: {
      scale: 1.3,
      x: 150,
      y: "calc(60vh)",
      rotate: 15,
      opacity: 1,
      transition: {
        duration: 0.5,
        ease: "easeInOut",
      },
    },
    zigzag2: {
      scale: 1.2,
      x: "calc(100vw - 300px)",
      y: "calc(30vh)",
      rotate: -15,
      opacity: 1,
      transition: {
        duration: 0.5,
        ease: "easeInOut",
      },
    },
    zigzag3: {
      scale: 1.1,
      x: "calc(100vw - 200px)",
      y: 30,
      rotate: 10,
      opacity: 1,
      transition: {
        duration: 0.5,
        ease: "easeInOut",
      },
    },
    resting: {
      scale: 0.9,
      x: "calc(100vw - 150px)",
      y: 20,
      rotate: 0,
      opacity: 1,
      transition: {
        duration: 0.3,
      },
    },
    retreat: {
      scale: 0,
      x: 0,
      y: 0,
      opacity: 0,
      transition: {
        duration: 0.5,
        ease: "easeIn",
      },
    },
  };

  // Closing animation - Elfie at top-right retreats
  const closingVariants = {
    hidden: {
      scale: 0.9,
      x: "calc(100vw - 150px)",
      y: 20,
      opacity: 1,
    },
    retreat: {
      scale: 0,
      x: 0,
      y: 0,
      opacity: 0,
      transition: {
        duration: 0.5,
        ease: "easeIn",
      },
    },
  };

  return (
    <motion.div
      className="fixed left-4 top-16 z-[200] pointer-events-none"
      initial="hidden"
      animate={
        isClosing 
          ? "retreat" 
          : isResting 
            ? "resting"
            : ["emerge", "flyDown", "pull", "zigzag1", "zigzag2", "zigzag3", "resting"]
      }
      variants={isClosing ? closingVariants : elfieVariants}
      onAnimationComplete={onAnimationComplete}
    >
      {/* Idle floating animation when resting */}
      {isResting && (
        <motion.div
          animate={{
            y: [0, -8, 0],
          }}
          transition={{
            duration: 2.5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <FloatingElfie isResting={isResting} />
        </motion.div>
      )}
      {!isResting && <FloatingElfie isResting={isResting} />}
    </motion.div>
  );
}

function FloatingElfie({ isResting }: { isResting: boolean }) {
  return (
    <>
      {/* PlanetBrick trademarked robot character */}
      <svg
        width="100"
        height="120"
        viewBox="0 0 100 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="drop-shadow-2xl"
      >
        <defs>
          <linearGradient id="slateGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#78909C" />
            <stop offset="100%" stopColor="#546E7A" />
          </linearGradient>
          <linearGradient id="beigeGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#E8C4A0" />
            <stop offset="100%" stopColor="#D4A574" />
          </linearGradient>
          <linearGradient id="wheelGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#A04545" />
            <stop offset="100%" stopColor="#8B3A3A" />
          </linearGradient>
          <radialGradient id="signalGlow">
            <stop offset="0%" stopColor="#78909C" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#78909C" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Signal waves - animated */}
        <motion.ellipse
          cx="50" cy="10" rx="15" ry="4"
          stroke="#78909C" strokeWidth="2" fill="none" opacity="0.6"
          animate={{ rx: [15, 22], ry: [4, 6], opacity: [0.6, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
        />
        <motion.ellipse
          cx="50" cy="10" rx="20" ry="5"
          stroke="#78909C" strokeWidth="2" fill="none" opacity="0.4"
          animate={{ rx: [20, 30], ry: [5, 8], opacity: [0.4, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: 0.5 }}
        />
        <motion.ellipse
          cx="50" cy="10" rx="25" ry="6"
          stroke="#78909C" strokeWidth="2" fill="none" opacity="0.3"
          animate={{ rx: [25, 38], ry: [6, 10], opacity: [0.3, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeOut", delay: 1 }}
        />

        {/* Antenna */}
        <rect x="48" y="12" width="4" height="8" rx="1" fill="#37474F" />
        <rect x="47" y="11" width="6" height="3" rx="1" fill="#546E7A" />

        {/* Head cylinder - top cap */}
        <ellipse cx="50" cy="20" rx="12" ry="3" fill="#546E7A" />
        
        {/* Head cylinder - body */}
        <rect x="38" y="20" width="24" height="18" fill="url(#slateGradient)" />
        <rect x="38" y="20" width="24" height="18" fill="#37474F" opacity="0.2" />
        
        {/* Head cylinder - bottom cap */}
        <ellipse cx="50" cy="38" rx="12" ry="3" fill="#37474F" />

        {/* Face panel - beige rectangle */}
        <rect x="41" y="24" width="18" height="12" rx="1" fill="url(#beigeGradient)" />
        <rect x="41" y="24" width="18" height="1" fill="#D4A574" opacity="0.5" />
        
        {/* Eyes - round goggles */}
        <circle cx="46" cy="29" r="3" fill="#37474F" />
        <circle cx="46" cy="29" r="2" fill="#E8A84D">
          <animate attributeName="opacity" values="1;0.3;1" dur="3s" repeatCount="indefinite" />
        </circle>
        <circle cx="54" cy="29" r="3" fill="#37474F" />
        <circle cx="54" cy="29" r="2" fill="#E8A84D">
          <animate attributeName="opacity" values="1;0.3;1" dur="3s" repeatCount="indefinite" />
        </circle>
        
        {/* Smile */}
        <path d="M 44 32 Q 50 35 56 32" stroke="#37474F" strokeWidth="1.5" fill="none" strokeLinecap="round" />

        {/* Neck ring */}
        <ellipse cx="50" cy="39" rx="8" ry="2" fill="#546E7A" />

        {/* Body cylinder - large barrel */}
        <ellipse cx="50" cy="50" rx="20" ry="6" fill="#546E7A" />
        <rect x="30" y="50" width="40" height="28" fill="url(#slateGradient)" />
        <ellipse cx="50" cy="78" rx="20" ry="6" fill="#37474F" />
        
        {/* Body detail - center panel */}
        <ellipse cx="50" cy="64" rx="12" ry="8" fill="url(#beigeGradient)" />
        <circle cx="50" cy="64" r="4" fill="#37474F" opacity="0.3" />

        {/* Left arm - mechanical */}
        <motion.g
          animate={isResting ? { rotate: [0, -10, 0, -5, 0] } : { rotate: [0, -15, 0] }}
          transition={
            isResting 
              ? { duration: 3, times: [0, 0.3, 0.5, 0.7, 1], repeat: Infinity }
              : { duration: 1, times: [0, 0.5, 1], repeat: Infinity, delay: 0.3 }
          }
          style={{ originX: "26px", originY: "60px" }}
        >
          <rect x="24" y="56" width="6" height="16" rx="2" fill="#546E7A" stroke="#37474F" strokeWidth="1" />
          <circle cx="27" cy="73" r="3" fill="#78909C" stroke="#37474F" strokeWidth="1" />
        </motion.g>

        {/* Right arm - mechanical */}
        <motion.g
          animate={isResting ? { rotate: [0, 10, 0, 5, 0] } : { rotate: [0, 15, 0] }}
          transition={
            isResting 
              ? { duration: 3, times: [0, 0.3, 0.5, 0.7, 1], repeat: Infinity, delay: 1 }
              : { duration: 1, times: [0, 0.5, 1], repeat: Infinity, delay: 0.8 }
          }
          style={{ originX: "70px", originY: "60px" }}
        >
          <rect x="70" y="56" width="6" height="16" rx="2" fill="#546E7A" stroke="#37474F" strokeWidth="1" />
          <circle cx="73" cy="73" r="3" fill="#78909C" stroke="#37474F" strokeWidth="1" />
        </motion.g>

        {/* Wheel assembly - red axle */}
        <rect x="28" y="82" width="44" height="8" rx="2" fill="url(#wheelGradient)" stroke="#37474F" strokeWidth="1" />
        
        {/* Left wheel - tank tread style */}
        <ellipse cx="36" cy="95" rx="10" ry="12" fill="#37474F" stroke="#546E7A" strokeWidth="2" />
        <ellipse cx="36" cy="95" rx="7" ry="9" fill="#546E7A" />
        <ellipse cx="36" cy="95" rx="4" ry="6" fill="#E8C4A0" />
        {/* Tread lines */}
        <line x1="26" y1="88" x2="26" y2="102" stroke="#37474F" strokeWidth="1" />
        <line x1="29" y1="86" x2="29" y2="104" stroke="#37474F" strokeWidth="1" />
        <line x1="32" y1="84" x2="32" y2="106" stroke="#37474F" strokeWidth="1" />
        <line x1="40" y1="84" x2="40" y2="106" stroke="#37474F" strokeWidth="1" />
        <line x1="43" y1="86" x2="43" y2="104" stroke="#37474F" strokeWidth="1" />
        <line x1="46" y1="88" x2="46" y2="102" stroke="#37474F" strokeWidth="1" />

        {/* Right wheel - tank tread style */}
        <ellipse cx="64" cy="95" rx="10" ry="12" fill="#37474F" stroke="#546E7A" strokeWidth="2" />
        <ellipse cx="64" cy="95" rx="7" ry="9" fill="#546E7A" />
        <ellipse cx="64" cy="95" rx="4" ry="6" fill="#E8C4A0" />
        {/* Tread lines */}
        <line x1="54" y1="88" x2="54" y2="102" stroke="#37474F" strokeWidth="1" />
        <line x1="57" y1="86" x2="57" y2="104" stroke="#37474F" strokeWidth="1" />
        <line x1="60" y1="84" x2="60" y2="106" stroke="#37474F" strokeWidth="1" />
        <line x1="68" y1="84" x2="68" y2="106" stroke="#37474F" strokeWidth="1" />
        <line x1="71" y1="86" x2="71" y2="104" stroke="#37474F" strokeWidth="1" />
        <line x1="74" y1="88" x2="74" y2="102" stroke="#37474F" strokeWidth="1" />
      </svg>
    </>
  );
}
