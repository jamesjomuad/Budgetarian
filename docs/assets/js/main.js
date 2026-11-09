/**
 * Budgetarian Marketing Website — Main JS
 * Mobile navigation toggle, FAQ accordion, scroll reveals, and animations.
 */

(function () {
  'use strict';

  // --- Mobile navigation ---
  const navToggle = document.querySelector('.nav-toggle');
  const mobileNav = document.querySelector('.mobile-nav');

  if (navToggle && mobileNav) {
    navToggle.addEventListener('click', function () {
      const isOpen = mobileNav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(isOpen));
      document.body.style.overflow = isOpen ? 'hidden' : '';

      // Swap hamburger/close icon
      const iconOpen = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
      const iconClose = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      navToggle.innerHTML = isOpen ? iconClose : iconOpen;
    });

    // Close mobile nav when a link is tapped
    mobileNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        mobileNav.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
        navToggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
      });
    });
  }

  // --- FAQ accordion ---
  document.querySelectorAll('.faq-question').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var item = btn.closest('.faq-item');
      if (item) {
        item.classList.toggle('open');
      }
    });
  });

  // --- Dynamic copyright year ---
  var yearEl = document.getElementById('copyright-year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  // --- Active nav link highlighting ---
  var currentPath = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a, .mobile-nav a').forEach(function (link) {
    var href = link.getAttribute('href') || '';
    var linkPage = href.split('/').pop() || 'index.html';
    if (linkPage === currentPath || (currentPath === '' && linkPage === 'index.html') || (currentPath.endsWith('/') && linkPage === 'index.html')) {
      link.classList.add('active');
    }
  });

  // --- Header scroll shadow ---
  var siteHeader = document.querySelector('.site-header');
  var lastScrollY = 0;
  var ticking = false;

  function updateHeader() {
    if (window.scrollY > 10) {
      siteHeader.classList.add('scrolled');
    } else {
      siteHeader.classList.remove('scrolled');
    }
    ticking = false;
  }

  window.addEventListener('scroll', function () {
    lastScrollY = window.scrollY;
    if (!ticking) {
      window.requestAnimationFrame(updateHeader);
      ticking = true;
    }
  }, { passive: true });

  // --- Scroll reveal animations ---
  if ('IntersectionObserver' in window) {
    var revealElements = document.querySelectorAll('[data-reveal]');
    
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          // Optionally unobserve after reveal for performance
          // revealObserver.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    });

    revealElements.forEach(function (el) {
      revealObserver.observe(el);
    });
  } else {
    // Fallback: reveal all immediately if IntersectionObserver not supported
    document.querySelectorAll('[data-reveal]').forEach(function (el) {
      el.classList.add('revealed');
    });
  }

  // --- Smooth anchor scrolling ---
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      var href = this.getAttribute('href');
      if (href === '#' || href === '') return;
      
      var target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        var headerHeight = document.querySelector('.site-header').offsetHeight;
        var targetPosition = target.getBoundingClientRect().top + window.pageYOffset - headerHeight - 20;
        
        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
      }
    });
  });

  // --- Screenshots carousel (Slick) ---
  if (typeof jQuery !== 'undefined' && jQuery.fn.slick) {
    jQuery('.screenshots-carousel').slick({
      dots: true,
      arrows: true,
      infinite: true,
      speed: 400,
      slidesToShow: 1,
      slidesToScroll: 1,
      autoplay: true,
      autoplaySpeed: 4000,
      pauseOnHover: true,
      adaptiveHeight: true,
      prevArrow: '<button type="button" class="slick-prev" aria-label="Previous screenshot"><span class="slick-arrow-text">&lsaquo;</span></button>',
      nextArrow: '<button type="button" class="slick-next" aria-label="Next screenshot"><span class="slick-arrow-text">&rsaquo;</span></button>',
    });
  }
})();
