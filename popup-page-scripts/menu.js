/**
 * menu.js
 * Premium menu button interactions
 * 
 * Features:
 * - 3D tilt with magnetic cursor attraction
 * - Holographic shimmer following mouse position
 * - Particle burst explosion on click
 * - Smooth ripple effects
 */

document.addEventListener('DOMContentLoaded', () => {
    const menuNav = document.querySelector('.menu-nav');
    if (!menuNav) return;

    const menuButtons = menuNav.querySelectorAll('.menu-btn');
    const resetTilt = (btn) => {
        btn.style.setProperty('--tilt-rotate-x', '0deg');
        btn.style.setProperty('--tilt-rotate-y', '0deg');
        btn.style.setProperty('--tilt-scale', '1');
        btn.style.setProperty('--tilt-translate-z', '0px');
    };

    // Smooth magnetic offsets to avoid jerky jumps
    const magnetState = new WeakMap();
    let magnetRAF = null;

    const ensureMagnetState = (btn) => {
        if (!magnetState.has(btn)) {
            magnetState.set(btn, { currentX: 0, currentY: 0, targetX: 0, targetY: 0 });
        }
        return magnetState.get(btn);
    };

    const startMagnetLoop = () => {
        if (magnetRAF) return;
        const step = () => {
            let moving = false;

            menuButtons.forEach(btn => {
                const state = magnetState.get(btn);
                if (!state) return;

                state.currentX += (state.targetX - state.currentX) * 0.18;
                state.currentY += (state.targetY - state.currentY) * 0.18;

                const deltaX = Math.abs(state.currentX - state.targetX);
                const deltaY = Math.abs(state.currentY - state.targetY);
                if (deltaX > 0.02 || deltaY > 0.02) {
                    moving = true;
                } else {
                    state.currentX = state.targetX;
                    state.currentY = state.targetY;
                }

                btn.style.setProperty('--magnet-translate-x', `${state.currentX}px`);
                btn.style.setProperty('--magnet-translate-y', `${state.currentY}px`);
            });

            if (moving) {
                magnetRAF = requestAnimationFrame(step);
            } else {
                magnetRAF = null;
            }
        };

        magnetRAF = requestAnimationFrame(step);
    };

    const setMagnetTarget = (btn, x, y, { immediate = false } = {}) => {
        const state = ensureMagnetState(btn);
        state.targetX = x;
        state.targetY = y;

        if (immediate) {
            state.currentX = x;
            state.currentY = y;
            btn.style.setProperty('--magnet-translate-x', `${x}px`);
            btn.style.setProperty('--magnet-translate-y', `${y}px`);
            return;
        }

        startMagnetLoop();
    };

    menuButtons.forEach((btn) => {
        ensureMagnetState(btn);

        // ﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄ
        // Mouse Move: 3D Tilt + Holographic Shimmer + Magnetic Effect
        // ﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄ
        btn.addEventListener('mousemove', (e) => {
            const rect = btn.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;

            // Calculate rotation (max 18 degrees)
            const maxRotation = 18;
            const rotateY = ((x - centerX) / centerX) * maxRotation;
            const rotateX = ((centerY - y) / centerY) * maxRotation;

            // Apply 3D transform with slight scale
            btn.style.setProperty('--tilt-rotate-x', `${rotateX}deg`);
            btn.style.setProperty('--tilt-rotate-y', `${rotateY}deg`);
            btn.style.setProperty('--tilt-scale', '1.05');
            btn.style.setProperty('--tilt-translate-z', '10px');
            setMagnetTarget(btn, 0, 0, { immediate: true });

            // Update shimmer position (CSS custom properties)
            const shimmerX = (x / rect.width) * 100;
            const shimmerY = (y / rect.height) * 100;
            btn.style.setProperty('--shimmer-x', `${shimmerX}%`);
            btn.style.setProperty('--shimmer-y', `${shimmerY}%`);

            // Update gradient position - follows cursor smoothly
            // Map cursor position to background-position (0-100% range scaled to 300% background)
            const gradientX = (x / rect.width) * 100;
            const gradientY = (y / rect.height) * 100;
            btn.style.setProperty('--gradient-x', `${gradientX}%`);
            btn.style.setProperty('--gradient-y', `${gradientY}%`);
        });

        // ﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄ
        // Mouse Enter
        // ﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄ
        btn.addEventListener('mouseenter', () => {
            btn.style.animationPlayState = 'paused';
            setMagnetTarget(btn, 0, 0, { immediate: true });
        });

        // ﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄ
        // Mouse Leave: Reset transforms
        // ﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄ
        btn.addEventListener('mouseleave', () => {
            resetTilt(btn);
            setMagnetTarget(btn, 0, 0, { immediate: true });
            btn.style.animationPlayState = 'running';

            // Smooth transition back (2 seconds for graceful return)
            btn.style.transition = 'transform 2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 1.2s ease';
            setTimeout(() => {
                btn.style.transition = '';
            }, 2000);
        });

        // ﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄ
        // Click: Ripple + Particle Burst
        // ﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄ
        btn.addEventListener('click', (e) => {
            const rect = btn.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;

            // Create ripple
            createRipple(btn, clickX, clickY, rect);

            // Create particle burst
            createParticleBurst(btn, clickX, clickY);

            // Add clicked class for glow effect
            btn.classList.add('clicked');
            setTimeout(() => btn.classList.remove('clicked'), 500);
        });
    });

    // ﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄ
    // Ripple Effect
    // ﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄ
    function createRipple(btn, x, y, rect) {
        const ripple = document.createElement('span');
        ripple.className = 'ripple';

        const size = Math.max(rect.width, rect.height) * 2.5;
        ripple.style.width = ripple.style.height = `${size}px`;
        ripple.style.left = `${x - size / 2}px`;
        ripple.style.top = `${y - size / 2}px`;

        btn.appendChild(ripple);

        setTimeout(() => ripple.remove(), 800);
    }

    // ﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄ
    // Particle Burst Effect
    // ﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄ
    function createParticleBurst(btn, x, y) {
        const particleCount = 12;
        const colors = [
            'linear-gradient(135deg, #ff6b6b, #feca57)',
            'linear-gradient(135deg, #48dbfb, #54a0ff)',
            'linear-gradient(135deg, #ff9ff3, #f368e0)',
            'linear-gradient(135deg, #5f27cd, #7a5cc8)',
            'linear-gradient(135deg, #1dd1a1, #10ac84)'
        ];

        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('span');
            particle.className = 'particle';

            // Random angle for burst direction
            const angle = (360 / particleCount) * i + (Math.random() * 30 - 15);
            const distance = 40 + Math.random() * 60;
            const tx = Math.cos(angle * Math.PI / 180) * distance;
            const ty = Math.sin(angle * Math.PI / 180) * distance;

            particle.style.left = `${x}px`;
            particle.style.top = `${y}px`;
            particle.style.setProperty('--tx', `${tx}px`);
            particle.style.setProperty('--ty', `${ty}px`);
            particle.style.background = colors[i % colors.length];
            particle.style.animationDelay = `${Math.random() * 0.1}s`;

            // Random size variation
            const size = 4 + Math.random() * 4;
            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;

            btn.appendChild(particle);

            setTimeout(() => particle.remove(), 900);
        }
    }

    // ﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄ
    // Optional: Magnetic effect for nearby cursor (subtle attraction)
    // ﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄﾄ
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        document.addEventListener('mousemove', (e) => {
            menuButtons.forEach(btn => {
                if (btn.matches(':hover')) {
                    return;
                }

                const rect = btn.getBoundingClientRect();
                const btnCenterX = rect.left + rect.width / 2;
                const btnCenterY = rect.top + rect.height / 2;

                const distX = e.clientX - btnCenterX;
                const distY = e.clientY - btnCenterY;
                const distance = Math.sqrt(distX * distX + distY * distY);

                const magneticRange = 200;
                if (distance >= magneticRange) {
                    setMagnetTarget(btn, 0, 0);
                    return;
                }

                // Soft attraction with eased falloff and clamp to avoid overlap
                const maxOffsetPx = 6;
                const influence = Math.max(0, (magneticRange - distance) / magneticRange);
                if (influence < 0.01) {
                    setMagnetTarget(btn, 0, 0);
                    return;
                }

                const eased = influence * influence * influence; // softer near edges
                if (distance === 0) {
                    setMagnetTarget(btn, 0, 0);
                    return;
                }

                const dirX = distX / distance;
                const dirY = distY / distance;
                const offsetMag = eased * maxOffsetPx;
                const moveX = dirX * offsetMag;
                const moveY = dirY * offsetMag;

                setMagnetTarget(btn, moveX, moveY);
            });
        }, { passive: true });
    }
});
