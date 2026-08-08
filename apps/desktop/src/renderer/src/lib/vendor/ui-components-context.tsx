import React, { createContext, useContext } from 'react';

// ============================================================================
// UI Primitive Component Props Interfaces
// ============================================================================

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  asChild?: boolean;
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  // Additional input props if needed
}

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  // Additional textarea props if needed
}

export interface CheckboxProps {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  'aria-invalid'?: boolean;
  'aria-errormessage'?: string;
}

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}

export interface SelectTriggerProps {
  className?: string;
  children?: React.ReactNode;
}

export interface SelectValueProps {
  placeholder?: string;
}

export interface SelectContentProps {
  children?: React.ReactNode;
}

export interface SelectItemProps {
  value: string;
  children?: React.ReactNode;
}

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}

export interface DialogContentProps {
  className?: string;
  children?: React.ReactNode;
}

export interface DialogHeaderProps {
  children?: React.ReactNode;
}

export interface DialogTitleProps {
  children?: React.ReactNode;
}

// Form-related components (react-hook-form integration)
export interface FormProps {
  children?: React.ReactNode;
  [key: string]: any; // Allow spreading form props
}

export interface FormFieldProps {
  control: any;
  name: string;
  render: (props: { field: any }) => React.ReactNode;
}

export interface FormItemProps {
  className?: string;
  children?: React.ReactNode;
}

export interface FormLabelProps {
  children?: React.ReactNode;
}

export interface FormControlProps {
  children?: React.ReactNode;
}

export interface FormDescriptionProps {
  children?: React.ReactNode;
}

export interface FormMessageProps {
  children?: React.ReactNode;
}

// ============================================================================
// UI Components Interface
// ============================================================================

export interface UIComponents {
  // Basic primitives
  Button: React.ComponentType<ButtonProps>;
  Input: React.ComponentType<InputProps>;
  Textarea: React.ComponentType<TextareaProps>;
  Checkbox: React.ComponentType<CheckboxProps>;
  
  // Select components
  Select: React.ComponentType<SelectProps>;
  SelectTrigger: React.ComponentType<SelectTriggerProps>;
  SelectValue: React.ComponentType<SelectValueProps>;
  SelectContent: React.ComponentType<SelectContentProps>;
  SelectItem: React.ComponentType<SelectItemProps>;
  
  // Dialog components
  Dialog: React.ComponentType<DialogProps>;
  DialogContent: React.ComponentType<DialogContentProps>;
  DialogHeader: React.ComponentType<DialogHeaderProps>;
  DialogTitle: React.ComponentType<DialogTitleProps>;
  
  // Form components (react-hook-form wrappers)
  Form: React.ComponentType<FormProps>;
  FormField: React.ComponentType<FormFieldProps>;
  FormItem: React.ComponentType<FormItemProps>;
  FormLabel: React.ComponentType<FormLabelProps>;
  FormControl: React.ComponentType<FormControlProps>;
  FormDescription: React.ComponentType<FormDescriptionProps>;
  FormMessage: React.ComponentType<FormMessageProps>;
  
  // Icons (as components that accept className)
  Icons: {
    Plus: React.ComponentType<{ className?: string }>;
    Trash: React.ComponentType<{ className?: string }>;
    ChevronUp: React.ComponentType<{ className?: string }>;
    ChevronDown: React.ComponentType<{ className?: string }>;
    Paperclip: React.ComponentType<{ className?: string }>;
    Loader: React.ComponentType<{ className?: string }>;
  };
  
  // Utility function for class names
  cn: (...inputs: any[]) => string;
}

// ============================================================================
// Context
// ============================================================================

const UIComponentsContext = createContext<UIComponents | null>(null);

export function useUIComponents(): UIComponents {
  const context = useContext(UIComponentsContext);
  if (!context) {
    throw new Error('useUIComponents must be used within a UIComponentsProvider');
  }
  return context;
}

// ============================================================================
// Provider
// ============================================================================

export interface UIComponentsProviderProps {
  components: UIComponents;
  children: React.ReactNode;
}

export function UIComponentsProvider({ components, children }: UIComponentsProviderProps) {
  return (
    <UIComponentsContext.Provider value={components}>
      {children}
    </UIComponentsContext.Provider>
  );
}

// ============================================================================
// Default fallback components (basic HTML elements for standalone use)
// ============================================================================

const defaultCn = (...inputs: any[]) => inputs.filter(Boolean).join(' ');

const DefaultButton: React.FC<ButtonProps> = ({ children, className, variant, size, ...props }) => (
  <button className={defaultCn('btn', variant && `btn-${variant}`, size && `btn-${size}`, className)} {...props}>
    {children}
  </button>
);

const DefaultInput: React.FC<InputProps> = ({ className, ...props }) => (
  <input className={defaultCn('input', className)} {...props} />
);

const DefaultTextarea: React.FC<TextareaProps> = ({ className, ...props }) => (
  <textarea className={defaultCn('textarea', className)} {...props} />
);

const DefaultCheckbox: React.FC<CheckboxProps> = ({ checked, onCheckedChange, className, ...props }) => (
  <input 
    type="checkbox" 
    checked={checked} 
    onChange={(e) => onCheckedChange?.(e.target.checked)}
    className={defaultCn('checkbox', className)}
    {...props}
  />
);

const DefaultSelect: React.FC<SelectProps> = ({ children, value, onValueChange, disabled }) => (
  <div className="select-wrapper">{children}</div>
);

const DefaultSelectTrigger: React.FC<SelectTriggerProps> = ({ children, className }) => (
  <div className={defaultCn('select-trigger', className)}>{children}</div>
);

const DefaultSelectValue: React.FC<SelectValueProps> = ({ placeholder }) => (
  <span>{placeholder}</span>
);

const DefaultSelectContent: React.FC<SelectContentProps> = ({ children }) => (
  <div className="select-content">{children}</div>
);

const DefaultSelectItem: React.FC<SelectItemProps> = ({ children, value }) => (
  <div data-value={value}>{children}</div>
);

const DefaultDialog: React.FC<DialogProps> = ({ children, open }) => (
  open ? <div className="dialog-overlay">{children}</div> : null
);

const DefaultDialogContent: React.FC<DialogContentProps> = ({ children, className }) => (
  <div className={defaultCn('dialog-content', className)}>{children}</div>
);

const DefaultDialogHeader: React.FC<DialogHeaderProps> = ({ children }) => (
  <div className="dialog-header">{children}</div>
);

const DefaultDialogTitle: React.FC<DialogTitleProps> = ({ children }) => (
  <h2 className="dialog-title">{children}</h2>
);

const DefaultForm: React.FC<FormProps> = ({ children, ...props }) => (
  <div {...props}>{children}</div>
);

const DefaultFormField: React.FC<FormFieldProps> = ({ render, control, name }) => {
  // Simplified - actual implementation should use react-hook-form Controller
  return <>{render({ field: { name, value: '', onChange: () => {} } })}</>;
};

const DefaultFormItem: React.FC<FormItemProps> = ({ children, className }) => (
  <div className={defaultCn('form-item', className)}>{children}</div>
);

const DefaultFormLabel: React.FC<FormLabelProps> = ({ children }) => (
  <label className="form-label">{children}</label>
);

const DefaultFormControl: React.FC<FormControlProps> = ({ children }) => (
  <div className="form-control">{children}</div>
);

const DefaultFormDescription: React.FC<FormDescriptionProps> = ({ children }) => (
  <p className="form-description">{children}</p>
);

const DefaultFormMessage: React.FC<FormMessageProps> = ({ children }) => (
  <p className="form-message">{children}</p>
);

// Default Icons (simple SVG placeholders)
const DefaultIcons = {
  Plus: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  ),
  Trash: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  ),
  ChevronUp: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
    </svg>
  ),
  ChevronDown: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  ),
  Paperclip: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
    </svg>
  ),
  Loader: ({ className }: { className?: string }) => (
    <svg className={defaultCn(className, 'animate-spin')} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
};

export const defaultUIComponents: UIComponents = {
  Button: DefaultButton,
  Input: DefaultInput,
  Textarea: DefaultTextarea,
  Checkbox: DefaultCheckbox,
  Select: DefaultSelect,
  SelectTrigger: DefaultSelectTrigger,
  SelectValue: DefaultSelectValue,
  SelectContent: DefaultSelectContent,
  SelectItem: DefaultSelectItem,
  Dialog: DefaultDialog,
  DialogContent: DefaultDialogContent,
  DialogHeader: DefaultDialogHeader,
  DialogTitle: DefaultDialogTitle,
  Form: DefaultForm,
  FormField: DefaultFormField,
  FormItem: DefaultFormItem,
  FormLabel: DefaultFormLabel,
  FormControl: DefaultFormControl,
  FormDescription: DefaultFormDescription,
  FormMessage: DefaultFormMessage,
  Icons: DefaultIcons,
  cn: defaultCn,
};
