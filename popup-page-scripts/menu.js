/**
 * menu.js
 * AURORA EDITION ✨ - Premium menu button interactions
 * 
 * Features:
 * - 3D tilt with magnetic cursor attraction
 * - Aurora glow following button
 * - Cursor spotlight effect
 * - Cosmic dust particles
 * - Particle burst explosion on click
 * - Smooth ripple effects
 */

document.addEventListener('DOMContentLoaded', () => {
    const menuNav = document.querySelector('.menu-nav');
    if (!menuNav) return;

    const menuButtons = menuNav.querySelectorAll('.menu-btn');

    // Initialize each button with extra elements
    menuButtons.forEach(btn => {
        // Add glow ring element
        if (!btn.querySelector('.glow-ring')) {
            const glowRing = document.createElement('span');
            glowRing.className = 'glow-ring';
            btn.appendChild(glowRing);
        }

        // Add cosmic dust particles
        for (let i = 0; i < 5; i++) {
            const dust = document.createElement('span');
            dust.className = 'cosmic-dust';
            dust.style.left = `${20 + Math.random() * 60}%`;
            dust.style.top = `${20 + Math.random() * 60}%`;
            dust.style.setProperty('--dust-x', `${(Math.random() - 0.5) * 20}px`);
            dust.style.setProperty('--dust-y', `${-5 - Math.random() * 15}px`);
            dust.style.animationDelay = `${Math.random() * 2}s`;
            btn.appendChild(dust);
        }
    });

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

                state.currentX += (state.targetX - state.currentX) * 0.15;
                state.currentY += (state.targetY - state.currentY) * 0.15;

                const deltaX = Math.abs(state.currentX - state.targetX);
                const deltaY = Math.abs(state.currentY - state.targetY);
                if (deltaX > 0.01 || deltaY > 0.01) {
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

        // ─────────────────────────────────────────────────────────────────────
        // Mouse Move: 3D Tilt + Spotlight + Magnetic Effect
        // ─────────────────────────────────────────────────────────────────────
        btn.addEventListener('mousemove', (e) => {
            const rect = btn.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;

            // Calculate rotation (max 15 degrees for smoother feel)
            const maxRotation = 15;
            const rotateY = ((x - centerX) / centerX) * maxRotation;
            const rotateX = ((centerY - y) / centerY) * maxRotation;

            // Apply 3D transform with slight scale
            btn.style.setProperty('--tilt-rotate-x', `${rotateX}deg`);
            btn.style.setProperty('--tilt-rotate-y', `${rotateY}deg`);
            btn.style.setProperty('--tilt-scale', '1.04');
            btn.style.setProperty('--tilt-translate-z', '8px');
            setMagnetTarget(btn, 0, 0, { immediate: true });

            // Update spotlight position (CSS custom properties)
            const shimmerX = (x / rect.width) * 100;
            const shimmerY = (y / rect.height) * 100;
            btn.style.setProperty('--shimmer-x', `${shimmerX}%`);
            btn.style.setProperty('--shimmer-y', `${shimmerY}%`);
        });

        // ─────────────────────────────────────────────────────────────────────
        // Mouse Enter
        // ─────────────────────────────────────────────────────────────────────
        btn.addEventListener('mouseenter', () => {
            btn.style.animationPlayState = 'paused';
            setMagnetTarget(btn, 0, 0, { immediate: true });
        });

        // ─────────────────────────────────────────────────────────────────────
        // Mouse Leave: Reset transforms
        // ─────────────────────────────────────────────────────────────────────
        btn.addEventListener('mouseleave', () => {
            resetTilt(btn);
            setMagnetTarget(btn, 0, 0, { immediate: true });
            btn.style.animationPlayState = 'running';

            // Smooth transition back (elastic ease)
            btn.style.transition = 'transform 1.5s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.8s ease';
            setTimeout(() => {
                btn.style.transition = '';
            }, 1500);
        });

        // ─────────────────────────────────────────────────────────────────────
        // Click: Ripple + Particle Burst + Shockwave
        // ─────────────────────────────────────────────────────────────────────
        btn.addEventListener('click', (e) => {
            const rect = btn.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;

            // Create ripple
            createRipple(btn, clickX, clickY, rect);

            // Create particle burst
            createParticleBurst(btn, clickX, clickY);

            // Add clicked class for glow pulse effect
            btn.classList.add('clicked');
            setTimeout(() => btn.classList.remove('clicked'), 600);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Ripple Effect
    // ─────────────────────────────────────────────────────────────────────────
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

    // ─────────────────────────────────────────────────────────────────────────
    // Particle Burst Effect
    // ─────────────────────────────────────────────────────────────────────────
    function createParticleBurst(btn, x, y) {
        const particleCount = 16;
        const colors = [
            'linear-gradient(135deg, #9b7ed9, #7a5cc8)',
            'linear-gradient(135deg, #c084fc, #a855f7)',
            'linear-gradient(135deg, #818cf8, #6366f1)',
            'linear-gradient(135deg, #f0abfc, #e879f9)',
            'linear-gradient(135deg, #a78bfa, #8b5cf6)'
        ];

        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('span');
            particle.className = 'particle';

            // Random angle for burst direction
            const angle = (360 / particleCount) * i + (Math.random() * 20 - 10);
            const distance = 50 + Math.random() * 70;
            const tx = Math.cos(angle * Math.PI / 180) * distance;
            const ty = Math.sin(angle * Math.PI / 180) * distance;

            particle.style.left = `${x}px`;
            particle.style.top = `${y}px`;
            particle.style.setProperty('--tx', `${tx}px`);
            particle.style.setProperty('--ty', `${ty}px`);
            particle.style.background = colors[i % colors.length];
            particle.style.animationDelay = `${Math.random() * 0.08}s`;

            // Random size variation
            const size = 4 + Math.random() * 5;
            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;

            btn.appendChild(particle);

            setTimeout(() => particle.remove(), 950);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Magnetic effect for nearby cursor (subtle attraction)
    // ─────────────────────────────────────────────────────────────────────────
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

                const magneticRange = 180;
                if (distance >= magneticRange) {
                    setMagnetTarget(btn, 0, 0);
                    return;
                }

                // Soft attraction with eased falloff
                const maxOffsetPx = 5;
                const influence = Math.max(0, (magneticRange - distance) / magneticRange);
                if (influence < 0.01) {
                    setMagnetTarget(btn, 0, 0);
                    return;
                }

                const eased = influence * influence * influence; // cubic easing
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
