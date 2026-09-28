"use client";

import { cn } from "@/lib/utils";
import Link, { LinkProps } from "next/link";
import React, { useState, createContext, useContext } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";

export interface Links {
  label: string;
  href: string;
  icon: React.JSX.Element | React.ReactNode;
  badge?: React.ReactNode;
  active?: boolean;
}

interface SidebarContextProps {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  animate: boolean;
}

const SidebarContext = createContext<SidebarContextProps | undefined>(
  undefined
);

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
};

export const SidebarProvider = ({
  children,
  open: openProp,
  setOpen: setOpenProp,
  animate = true,
}: {
  children: React.ReactNode;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  animate?: boolean;
}) => {
  const [openState, setOpenState] = useState(false);

  const open = openProp !== undefined ? openProp : openState;
  const setOpen = setOpenProp !== undefined ? setOpenProp : setOpenState;

  return (
    <SidebarContext.Provider value={{ open, setOpen, animate }}>
      {children}
    </SidebarContext.Provider>
  );
};

export const Sidebar = ({
  children,
  open,
  setOpen,
  animate = true,
}: {
  children: React.ReactNode;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  animate?: boolean;
}) => {
  return (
    <SidebarProvider open={open} setOpen={setOpen} animate={animate}>
      {children}
    </SidebarProvider>
  );
};

export const SidebarBody = ({
  mobileTitle,
  ...props
}: React.ComponentProps<typeof motion.div> & { mobileTitle?: string }) => {
  return (
    <>
      <DesktopSidebar {...props} />
      <MobileSidebar mobileTitle={mobileTitle} {...(props as React.ComponentProps<"div">)} />
    </>
  );
};

export const DesktopSidebar = ({
  className,
  children,
  ...props
}: React.ComponentProps<typeof motion.div>) => {
  const { open, animate } = useSidebar();
  return (
    <motion.div
      className={cn(
        "h-full px-3 py-3.5 hidden md:flex md:flex-col sidebar-panel border-r border-[var(--sidebar-border)] w-[260px] flex-shrink-0 select-none overflow-hidden justify-between",
        className
      )}
      animate={{
        width: animate ? (open ? "260px" : "64px") : "260px",
      }}
      transition={{
        duration: 0.22,
        ease: "easeInOut",
      }}
      {...props}
    >
      {children}
    </motion.div>
  );
};

export const MobileSidebar = ({
  className,
  children,
  mobileTitle,
  ...props
}: React.ComponentProps<"div"> & { mobileTitle?: string }) => {
  const { open, setOpen } = useSidebar();
  return (
    <>
      <div
        className={cn(
          "h-12 px-3.5 flex flex-row md:hidden items-center justify-between bg-[var(--topbar-bg)] backdrop-blur-md border-b border-[var(--sidebar-border)] w-full sticky top-0 z-40 shrink-0 select-none"
        )}
        {...props}
      >
        <div className="flex items-center gap-2 min-w-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="简册" className="w-7 h-7 rounded-lg object-cover shrink-0" />
          <div className="flex items-center gap-1.5 min-w-0 text-[14px]">
            <span className="font-semibold text-[var(--ink)] shrink-0">简册</span>
            {mobileTitle && (
              <>
                <span className="text-[var(--ink-faint)] font-light">/</span>
                <span className="font-medium text-[var(--ink)] truncate">{mobileTitle}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex justify-end z-20 shrink-0">
          <button
            type="button"
            className="w-8 h-8 flex items-center justify-center text-[var(--ink)] rounded-lg hover:bg-[var(--line)] active:scale-95 cursor-pointer transition"
            onClick={() => setOpen(!open)}
            aria-label="切换菜单"
          >
            <Menu className="h-5 w-5 stroke-[1.8]" />
          </button>
        </div>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ x: "-100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "-100%", opacity: 0 }}
              transition={{
                duration: 0.22,
                ease: [0.16, 1, 0.3, 1],
              }}
              className={cn(
                "fixed h-full w-full inset-0 sidebar-panel p-4 sm:p-6 z-[100] flex flex-col justify-between overflow-y-auto pb-safe",
                className
              )}
            >
              <div
                className="absolute right-4 top-4 z-50 text-[var(--ink)] cursor-pointer w-8 h-8 rounded-lg hover:bg-[var(--line)] flex items-center justify-center active:scale-95 transition"
                onClick={() => setOpen(false)}
              >
                <X className="h-5 w-5 stroke-[1.8]" />
              </div>
              <div className="h-full flex flex-col justify-between" onClick={() => setOpen(false)}>
                {children}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
};

export const SidebarLink = ({
  link,
  className,
  ...props
}: {
  link: Links;
  className?: string;
  props?: LinkProps;
}) => {
  const { open, animate } = useSidebar();
  return (
    <Link
      href={link.href}
      title={!open ? link.label : undefined}
      className={cn(
        "flex items-center justify-start gap-3 group/sidebar py-2 px-2.5 rounded-xl transition-all duration-150 relative text-[13px] my-0.5",
        !open && "justify-center px-0",
        link.active
          ? "bg-[var(--active-bg)] text-[var(--active-fg)] font-medium shadow-sm"
          : "text-[var(--ink)] hover:bg-[var(--line)]",
        className
      )}
      {...props}
    >
      <div className={cn("flex-shrink-0 flex items-center justify-center w-5 h-5", link.active ? "text-[var(--active-fg)] [&_svg]:!stroke-white" : "")}>
        {link.icon}
      </div>
      <motion.span
        animate={{
          display: animate ? (open ? "inline-block" : "none") : "inline-block",
          opacity: animate ? (open ? 1 : 0) : 1,
        }}
        className={cn(
          "truncate transition duration-150 whitespace-nowrap flex-1 text-left",
          link.active ? "text-[var(--active-fg)] font-medium" : "text-[var(--ink)]"
        )}
      >
        {link.label}
      </motion.span>
      {link.badge && (
        <motion.span
          animate={{
            display: animate ? (open ? "inline-block" : "none") : "inline-block",
            opacity: animate ? (open ? 1 : 0) : 1,
          }}
          className="flex-shrink-0 ml-auto"
        >
          {link.badge}
        </motion.span>
      )}
    </Link>
  );
};
